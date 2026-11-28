#!/usr/bin/env bash
# Isolated regression: no SSH, real releases or live services.
set -euo pipefail
test "$(id -u)" -ne 0
installer="$(realpath deploy/cloudcore/install.sh)"
work="$(mktemp -d)"
export HOME="$work/home"
root="$HOME/lean-center-cloudcore-qa"
mkdir -p -m 700 "$root/private-devtunnel" "$work/bin"
cleanup() {
  if [[ -f "$work/child.pid" ]]; then kill "$(cat "$work/child.pid")" 2>/dev/null || true; fi
  rm -rf -- "$work"
}
trap cleanup EXIT
export LOCK_TEST_PID="$work/child.pid"
cat > "$work/bin/id" <<'ID'
#!/bin/bash
if [[ "$*" == "-un" ]]; then echo lean-deploy; else exec /usr/bin/id "$@"; fi
ID
chmod +x "$work/bin/id"
export PATH="$work/bin:$PATH"
cat > "$root/private-devtunnel/control-named.sh" <<'CONTROL'
#!/bin/bash
set -euo pipefail
test ! -e "/proc/$$/fd/9"
if flock -n "$HOME/lean-center-cloudcore-qa/.install.lock" true; then
  echo "installer released lock before promotion ended" >&2
  exit 17
fi
nohup sleep 120 </dev/null >/dev/null 2>&1 &
echo "$!" > "$LOCK_TEST_PID"
CONTROL
sha="$(printf '%040d' 1)"
mkdir -p "$root/$sha"
printf '%s\n' "$sha" > "$root/$sha/.qa-verified"
sum="$(printf '%064d' 0)"
bash "$installer" "$sha" "$sum" 1 </dev/null
test -s "$LOCK_TEST_PID"
kill -0 "$(cat "$LOCK_TEST_PID")"
flock -n "$root/.install.lock" true
kill "$(cat "$LOCK_TEST_PID")"
rm "$LOCK_TEST_PID"
# Also exercise a new release. The simulated runtime asserts no inherited FD.
mkdir -p "$work/bundle/.runtime"
cat > "$work/bundle/.runtime/node" <<'NODE'
#!/bin/bash
set -euo pipefail
test ! -e "/proc/$$/fd/9"
NODE
chmod +x "$work/bundle/.runtime/node"
tar -czf "$work/bundle.tgz" -C "$work/bundle" .
sha="$(printf '%040d' 2)"
sum="$(sha256sum "$work/bundle.tgz" | cut -d' ' -f1)"
bash "$installer" "$sha" "$sum" 2 < "$work/bundle.tgz"
test "$(cat "$root/$sha/.qa-verified")" = "$sha"
kill -0 "$(cat "$LOCK_TEST_PID")"
flock -n "$root/.install.lock" true
echo CLOUDCORE_INSTALL_LOCK_ISOLATION_OK
