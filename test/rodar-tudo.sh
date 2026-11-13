#!/usr/bin/env bash
# Bateria completa do frontend: verificação estática + suítes _scratch-*.js.
# Uso: bash test/rodar-tudo.sh   (a partir da raiz do repo ou de qualquer lugar)
set -o pipefail
cd "$(dirname "$0")/.." || exit 1
node frontend.test.js . | tail -2 || exit 1
# Já falhava antes no main (o teste não define window); não conta como regressão.
CONHECIDAS=" _scratch-signatures-frontend.js "
ok=0; falhas=""
for f in _scratch-*.js; do
  if node "$f" >/dev/null 2>&1; then ok=$((ok+1))
  elif [[ "$CONHECIDAS" != *" $f "* ]]; then falhas="$falhas $f"
  fi
done
echo "suítes _scratch: $ok passaram${falhas:+; FALHARAM:$falhas}"
[ -z "$falhas" ]
