# Arquitectura

## Servicios

| Servicio | Stack | Responsabilidad | Puerto |
|---|---|---|---|
| `web` | Angular 22, nginx | UI móvil-first (PWA). Sirve los estáticos y hace de reverse proxy same-origin hacia el gateway | 8080 |
| `api-gateway` | Node 22, Fastify 5, Mercurius | Único punto de entrada: autenticación, rate limit, GraphQL (BFF), proxy REST para binarios | 4000 |
| `fields-service` | Node 22, Fastify 5, Zod, MongoDB | Dominio de lotes: geometrías, reglas geoespaciales, observaciones e imágenes | 4001 (interno) |
| `ai-service` | Python 3.12, FastAPI, scikit-learn | Pronóstico de rendimiento (cuantiles) y análisis de imágenes RGB | 8000 (interno) |

Solo `web` (y `api-gateway` en desarrollo) se exponen públicamente. `fields-service` y `ai-service` viven en la red privada y confían en el `x-tenant-id` que inyecta el gateway.

## Contratos

- **Web → Gateway:** GraphQL en `/graphql` (queries por GET y mutaciones por POST) y REST en `/api/v1/*` para fotos.
- **Gateway → fields-service:** REST `/v1/*` documentado con OpenAPI (generado a partir de los esquemas Zod en `/docs`).
- **fields-service / Gateway → ai-service:** REST `/v1/*` con OpenAPI de FastAPI. Las respuestas se **validan con Zod** del lado Node, así que una deriva de contrato falla de forma explícita.
- **Errores:** REST usa RFC 9457 `application/problem+json` con un `code` estable (`NOT_FOUND`, `INVALID_GEOMETRY`, `UPSTREAM_UNAVAILABLE`…). GraphQL usa `extensions.code` (`BAD_USER_INPUT`, `NOT_FOUND`, `UNAUTHENTICATED`, `UPSTREAM_UNAVAILABLE`) y `extensions.reason`.

## Modelo de datos (MongoDB)

```
fields {
  _id, tenantId, name, crop,
  geometry: GeoJSON Polygon,      // índice 2dsphere → $geoIntersects (viewport)
  centroid: GeoJSON Point,        // índice 2dsphere → $nearSphere (cercanía)
  areaHa, soilPh?, plantedAt?, notes?,
  latestObservation?: {...},      // desnormalizado: la lista se pinta sin un join
  createdAt, updatedAt
}
índices: {tenantId, _id↓}, {tenantId, crop, _id↓}, geometry 2dsphere, centroid 2dsphere

observations { _id, tenantId, fieldId, capturedAt, vegetationCoverage, stressRatio, exgMean, health, imageFileId, ... }
índice: {tenantId, fieldId, _id↓}

observationImages.files / .chunks   (GridFS; en Azure equivale a Blob Storage)
```

`latestObservation` se actualiza con una **escritura condicional** (`capturedAt <= nuevo`), así que una observación antigua que se procese tarde no pisa una más reciente.

## Modelo predictivo

- **Features:** cultivo (one-hot), lluvia anual, temperatura media, pH del suelo y cobertura vegetal (sale del análisis de la última foto, lo que conecta visión y predicción).
- **Modelo:** `HistGradientBoostingRegressor` con `loss="quantile"` para α = 0.1, 0.5 y 0.9. Se ordenan las salidas para garantizar P10 ≤ P50 ≤ P90.
- **Datos:** sintéticos, con priors agronómicos (respuesta gaussiana alrededor del óptimo de cada cultivo), guardados en SQLite. En producción se reemplazan por cosechas históricas (Fabric / Cosmos DB).
- **Métricas actuales** (test 20 %): R² ≈ 0.94, MAE ≈ 0.47 t/ha, cobertura del intervalo P10–P90 ≈ 73 % (el ideal es 80 %).
- **Artefacto:** versionado (`modelVersion`), con métricas y fecha de entrenamiento. Se entrena en el build de la imagen con semilla fija, de modo que es reproducible.

## Análisis de imagen

Usa el índice **Excess Green** (ExG = 2g − r − b sobre coordenadas cromáticas), combinado con dominancia G > R para no confundir follaje amarillo con follaje sano. Detecta el estrés (clorosis o sequía) como píxeles amarillos o marrones con canal azul bajo. Antes de analizar, la imagen se reduce a 512 px, así que la latencia es constante sin importar la cámara. Funciona con cualquier cámara de celular, sin sensores multiespectrales.

## Escalabilidad

- Todos los servicios son **stateless**: escalan horizontalmente (Container Apps escala con KEDA por HTTP concurrente).
- El análisis de imágenes es CPU-bound: corre en un threadpool y en servicio aparte, así que escala de forma independiente del CRUD.
- **Siguiente paso** con volumen: hacer el análisis asíncrono (la foto va a Blob, se publica un evento en Service Bus, un worker de IA procesa y fields-service actualiza la observación). El contrato REST ya devuelve la observación con su id, así que el cambio solo afecta a la UI (estado "procesando").
