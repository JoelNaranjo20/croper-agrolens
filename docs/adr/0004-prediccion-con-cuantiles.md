# ADR 0004: Pronóstico como rango P10/P50/P90

**Estado:** aceptada

## Decisión
Se usan tres `HistGradientBoostingRegressor` con pérdida cuantílica. La API devuelve un rango, no un único número. La cobertura vegetal medida en la última foto entra como feature, lo que conecta visión y predicción.

## Por qué
Un punto da una precisión falsa. Un productor decide sobre crédito, insumos o venta anticipada en función del riesgo (escenario pesimista). Además, el artefacto lleva versión, métricas y fecha, de modo que cada pronóstico es trazable al modelo que lo produjo.

## Limitaciones
Los datos son sintéticos con priors agronómicos. La cobertura del intervalo (≈73 %) está por debajo del 80 % nominal. Con datos reales se calibraría con conformal prediction.
