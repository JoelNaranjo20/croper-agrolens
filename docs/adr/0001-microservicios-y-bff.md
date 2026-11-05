# ADR 0001: Microservicios por capacidad con un gateway BFF

**Estado:** aceptada

## Contexto
La vacante pide microservicios. El dominio tiene dos capacidades con perfiles de carga muy distintos: CRUD geoespacial (I/O-bound) e inferencia y visión (CPU-bound, Python).

## Decisión
- Tres servicios desplegables: `fields-service` (Node), `ai-service` (Python) y `api-gateway` (Node, BFF).
- El gateway es el único punto público. Se encarga de auth, rate limit y composición (GraphQL).
- Los servicios internos exponen REST con OpenAPI.

## Consecuencias
- Pros: La IA escala de forma independiente, cada servicio usa el mejor lenguaje para su tarea y los fallos quedan aislados (si la IA cae, el CRUD sigue funcionando).
- Contras: Más piezas que operar. Se mitiga con imágenes homogéneas, health checks y `x-request-id` de extremo a extremo.
- Descartado: un monolito modular. Sería válido para un MVP, pero no demostraría lo que pide la vacante, y la separación Python/Node es natural aquí.
