# ADR 0006: Autenticación en el borde y multi-tenancy por claim

**Estado:** aceptada

## Decisión
- El gateway verifica JWT (RS256/ES256) contra JWKS (Entra ID, Auth0, Cognito o Keycloak), validando issuer, audience y expiración.
- El tenant sale de un claim configurable (`AUTH_TENANT_CLAIM`). El gateway **sobrescribe** `x-tenant-id` hacia los servicios internos, así que un cliente no puede suplantar a otro tenant.
- Los servicios internos solo aceptan tráfico de la red privada y filtran cada consulta por tenant.
- `AUTH_MODE=none` existe solo para la demo, y la validación de configuración lo **prohíbe en producción**.

## Pendiente
Las imágenes servidas por `<img>` no pueden enviar el header Authorization. En producción se usarán URLs SAS de Blob Storage con expiración corta, o una cookie de sesión `SameSite=Strict`.
