#!/usr/bin/env bash
# Levanta todo el stack y carga datos de ejemplo. Se ejecuta en cada arranque del Codespace.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Construyendo y levantando AgroLens (la primera vez tarda unos minutos)..."
docker compose up -d --build

echo "==> Esperando a que el gateway esté listo..."
for i in $(seq 1 90); do
  if curl -fs http://localhost:4000/health/ready >/dev/null; then break; fi
  sleep 3
done

echo "==> Cargando lotes de ejemplo..."
docker compose --profile seed run --rm seed

echo ""
echo "AgroLens listo:  pestaña PORTS → puerto 8080 (app) · 4000/graphiql · 8000/docs"
