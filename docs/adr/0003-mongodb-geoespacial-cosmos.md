# ADR 0003: MongoDB con índices 2dsphere (compatible con Azure Cosmos DB vCore)

**Estado:** aceptada

## Decisión
- Las geometrías se guardan como GeoJSON con índices `2dsphere` sobre el polígono (consultas por viewport con `$geoIntersects`) y sobre el centroide (cercanía con `$nearSphere`).
- Driver oficial con un patrón repository (sin ODM): control explícito de índices y proyecciones.
- GridFS para las imágenes en la demo. En Azure se usa **Blob Storage con URLs SAS** (la interfaz `ObservationRepository` ya lo abstrae).
- Cada documento lleva `tenantId` y todos los índices compuestos empiezan por él (es también la shard key natural).

## Alternativas
- PostgreSQL + PostGIS: más potente para análisis espacial, pero la vacante menciona Cosmos DB y MongoDB, y el esquema de observaciones es flexible.
