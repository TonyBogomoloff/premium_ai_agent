#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  runtime="/home/tony/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin"
  if [[ -x "$runtime/node" ]]; then export PATH="$runtime:$PATH"; else echo 'Нужен Node.js 24 или новее.' >&2; exit 1; fi
fi
case "${1:-start}" in
  start) exec node server/index.mjs ;;
  dev) exec node node_modules/vite/bin/vite.js --host 127.0.0.1 ;;
  build) exec node node_modules/vite/bin/vite.js build ;;
  test) exec node --test tests/*.test.mjs ;;
  check) exec node scripts/bot.mjs check ;;
  setup) exec node scripts/bot.mjs setup ;;
  *) echo 'Использование: ./run.sh start|dev|build|test|check|setup' >&2; exit 2 ;;
esac
