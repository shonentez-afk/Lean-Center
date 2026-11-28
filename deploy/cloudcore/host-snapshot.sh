#!/bin/bash
set -euo pipefail
umask 077
[[ "$(id -un)" == lean-deploy && "$(id -u)" != 0 && $# == 2 && "$1" =~ ^[a-f0-9]{40}$ ]] || exit 1
s="$(cd -- "$(dirname -- "$(realpath -- "$0")")" && pwd)"
root="$(dirname -- "$s")"
release="$root/$1"
data="$2"
[[ "$data" == "$root/8f1cf40db232d0fc5afafe386245617a117f77ee/data" && ! -L "$data" ]]
[[ "$(cat "$release/.qa-verified")" == "$1" && ! -e "$data/writer.lock" ]]
backup_root="$root/qa-backups"
test ! -L "$backup_root"
mkdir -m 700 -p -- "$backup_root"
test "$(stat -c '%a:%u' "$backup_root")" = "700:$(id -u)"
stage="$(mktemp -d "$backup_root/.snapshot.XXXXXXXX")"
trap 'rmdir -- "$stage" 2>/dev/null || true' EXIT
target="$backup_root/$(date -u +%Y%m%dT%H%M%SZ)-$(basename "$stage" | cut -d. -f3)"
cd "$release"
env -i PATH=/usr/bin:/bin LC81_QA=1 .runtime/node server/lc81-maintenance.mjs backup "$data" "$stage/data" >/dev/null
test ! -e "$target" && test ! -L "$target"
mv -T -- "$stage/data" "$target"
printf '%s\n' "$target"
