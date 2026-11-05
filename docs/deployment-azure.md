# Despliegue en Azure

| Pieza | Servicio Azure |
|---|---|
| Contenedores (web, gateway, fields, ai) | **Azure Container Apps** (escala a cero, KEDA por HTTP y revisiones para blue/green) |
| Base de datos | **Azure Cosmos DB for MongoDB (vCore)**: soporta `2dsphere` y el mismo driver |
| Imágenes | **Blob Storage** con URLs SAS y Azure Front Door como CDN |
| Secretos | **Key Vault** con referencias desde Container Apps (managed identity) |
| Identidad | **Entra ID / External ID**: `AUTH_MODE=jwt` |
| Observabilidad | Logs JSON en **Log Analytics / Application Insights** (correlación por `x-request-id`) |
| Datos y analítica | Export de observaciones a **Microsoft Fabric** para reentrenar el modelo |

## Pipeline

1. **CI** (`.github/workflows/ci.yml`): lint, tests (incluida la suite contra Mongo real), build y push de imágenes a GHCR etiquetadas con el SHA.
2. **CD** (`deploy.yml`, manual): promueve un SHA ya probado a `staging` y luego a `production`, con aprobación en GitHub Environments. Se autentica con **OIDC** (sin secretos de larga duración).
3. Container Apps crea una nueva **revisión**. El tráfico solo pasa a ella cuando `/health/ready` responde 200. Para hacer rollback se reasigna el tráfico a la revisión anterior.

## Variables por servicio (producción)

```
api-gateway:    NODE_ENV=production AUTH_MODE=jwt AUTH_JWKS_URL AUTH_ISSUER AUTH_AUDIENCE
                FIELDS_SERVICE_URL=http://agrolens-fields-service  AI_SERVICE_URL=http://agrolens-ai-service
                CORS_ORIGINS=https://app.agrolens.co
fields-service: NODE_ENV=production MONGO_URI=@Microsoft.KeyVault(...)  AI_SERVICE_URL=...
ai-service:     AI_ENV=production
web:            GATEWAY_URL=http://agrolens-api-gateway
```

Solo `web` tiene ingress externo. Los demás usan ingress interno dentro del Container Apps Environment (una VNet).
