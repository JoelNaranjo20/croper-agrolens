# ADR 0002: GraphQL en el borde, REST entre servicios y para binarios

**Estado:** aceptada

## Decisión
- **GraphQL (Mercurius)** hacia la UI: cada pantalla pide exactamente sus campos (menos bytes en 3G) y `Field.yieldForecast` compone dos servicios en una sola petición.
- **Queries por GET** (con variables en la query string): se pueden cachear en el service worker y en una CDN, y eso es lo que da el modo offline. Las mutaciones van por POST.
- **REST interno** con OpenAPI generado desde Zod: simple, versionable con `/v1` y fácil de probar.
- **Binarios (fotos) por REST multipart**, pasando por el gateway con `@fastify/http-proxy`.

## Consecuencias
- Hay que mantener el esquema GraphQL alineado con los contratos REST. Las respuestas upstream se validan con Zod.
- `queryDepth` limita las consultas abusivas. JIT de graphql-jit para las queries frecuentes.
