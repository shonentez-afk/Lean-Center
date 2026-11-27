#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname -- "$(realpath -- "$0")")/../.."
test "$(id -un)" = lean-deploy
test "$(id -u)" -ne 0
umask 077
exec env -i PATH=/usr/bin:/bin LC81_QA=1 LC81_LOOPBACK_ONLY=1 \
  LC81_DATA_DIR="$PWD/data" LC81_ORIGIN=https://localhost:18081 PORT=18081 \
  "$PWD/.runtime/node" server/lc81-main.mjs
