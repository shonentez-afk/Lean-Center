#!/usr/bin/env bash
set -euo pipefail
umask 077

fail() { printf 'CLOUDCORE_QA_ERROR_%s\n' "$1"; exit 1; }

[[ "$(id -un)" == lean-deploy && "$(id -u)" != 0 ]] || fail USER
[[ "$(uname -m)" == x86_64 ]] || fail ARCH
[[ $# == 3 && "$1" =~ ^[a-f0-9]{40}$ && "$2" =~ ^[a-f0-9]{64}$ && "$3" =~ ^[1-9][0-9]{0,8}$ ]] || fail RELEASE
root="$HOME/lean-center-cloudcore-qa"
release="$root/$1"
controller="$root/private-devtunnel/control-named.sh"
[[ -f "$controller" && ! -L "$controller" ]] || fail CONTROLLER
[[ ! -L "$root" && ! -L "$root/.install.lock" ]] || fail PATH
mkdir -p -m 700 -- "$root" || fail PATH
[[ "$(stat -c '%a:%u' "$root")" == "700:$(id -u)" ]] || fail PATH
exec 9>"$root/.install.lock"
flock -w 15 9 || fail LOCK
# Only the installer owns FD 9. Never inherit it into the smoke test or
# controller: a detached supervisor/tunnel could otherwise retain the flock.
if [[ -e "$release" || -L "$release" ]]; then
  cat >/dev/null
  [[ ! -L "$release" && -f "$release/.qa-verified" && "$(cat "$release/.qa-verified")" == "$1" ]] || fail RELEASE_EXISTS
  printf 'CLOUDCORE_QA_ALREADY_VERIFIED\n'
  /bin/bash "$controller" promote "$1" "$3" 9>&-
  exit 0
fi
stage="$(mktemp -d "$root/.stage.XXXXXXXX")" || fail STAGE
trap 'rm -rf -- "$stage"' EXIT
cat > "$stage/bundle.tgz" || fail TRANSFER
printf '%s  %s\n' "$2" "$stage/bundle.tgz" | sha256sum --check --status || fail CHECKSUM
tar -xzf "$stage/bundle.tgz" -C "$stage" --no-same-owner --no-same-permissions || fail UNPACK
rm -- "$stage/bundle.tgz"
(
  cd "$stage"
  "$PWD/.runtime/node" --version > /dev/null 2>&1 || exit 2
  timeout --kill-after=10s 90s "$PWD/.runtime/node" deploy/cloudcore/smoke.mjs > "$stage/.smoke-log" 2>&1
) 9>&- && status=0 || status=$?
if [[ "$status" == 2 ]]; then fail NODE_RUNTIME; fi
if [[ "$status" != 0 ]]; then
  if [[ -f "$stage/.smoke-log" ]]; then
    grep -E '^LC81_(STARTUP_[A-Z0-9_]+|SMOKE_(BOOTSTRAP|RESTART))$' "$stage/.smoke-log" || true
  fi
  fail SMOKE
fi
rm -- "$stage/.smoke-log"
printf '%s\n' "$1" > "$stage/.qa-verified"
mv -T -- "$stage" "$release" || fail PUBLISH
trap - EXIT
printf 'CLOUDCORE_QA_INSTALLED_AND_VERIFIED\n'
/bin/bash "$controller" promote "$1" "$3" 9>&-
