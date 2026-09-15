#!/bin/zsh
set -euo pipefail
cd "$(dirname "$0")/.."
exec pnpm start
