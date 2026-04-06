#!/usr/bin/env bash
set -euo pipefail

# Ignora diretórios de vendor/build para evitar falsos positivos em mapas/minificados.
if rg -n "^(<<<<<<<|=======|>>>>>>>)" \
  --glob '!**/vendor/**' \
  --glob '!**/*.map' \
  --glob '!**/node_modules/**' .; then
  echo "\n❌ Marcadores de conflito encontrados. Resolva antes de commitar."
  exit 1
fi

echo "✅ Nenhum marcador de conflito encontrado."
