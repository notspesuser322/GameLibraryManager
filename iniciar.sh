#!/usr/bin/env bash
# Inicia Nébula y abre el navegador. Uso: ./iniciar.sh [--demo] [--port 5000]
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  Falta Node.js (version 18 o superior): https://nodejs.org"
  echo
  exit 1
fi

echo
echo "  Iniciando Nébula... el navegador se abrira solo."
echo "  Para cerrar la aplicacion pulsa Ctrl+C."
echo
exec node server/index.js --open "$@"
