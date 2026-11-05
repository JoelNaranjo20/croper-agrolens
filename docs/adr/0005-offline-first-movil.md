# ADR 0005: PWA offline-first para zonas rurales

**Estado:** aceptada

## Decisión
- Angular PWA (service worker): app shell precacheado y estrategia *freshness* para las queries GraphQL GET (timeout de 4 s y luego caché), *performance* para teselas y fotos.
- Cola de fotos en IndexedDB que se vacía con el evento `online`. Los 4xx se descartan para no quedar en un bucle de reintentos.
- Compresión de fotos en el cliente (a 1280 px, JPEG 0.8): de unos 4 MB a unos 200 kB.
- Presupuesto de bundle en el build (falla el CI si se excede). Leaflet y Geoman se cargan bajo demanda.
- Sin Apollo ni NgRx: un cliente GraphQL mínimo con signals.

## Consecuencias
Las mutaciones de lotes (crear o editar) requieren conexión. Si el negocio lo exige, el siguiente paso es una cola de mutaciones con resolución de conflictos.
