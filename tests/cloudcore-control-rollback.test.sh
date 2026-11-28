#!/usr/bin/env bash
# Real controller logic, disposable fake supervisor and synthetic data only.
set -euo pipefail
umask 077
test "$(id -u)" -ne 0
work="$(mktemp -d)"
root="$work/releases"
s="$root/private-devtunnel"
baseline=8f1cf40db232d0fc5afafe386245617a117f77ee
candidate="$(printf '%040d' 7)"
data="$root/$baseline/data"
mkdir -p -m 700 "$s" "$data" "$root/qa-backups" "$work/bin"
cp deploy/cloudcore/host-control.sh "$s/control-named.sh"
cat > "$work/bin/id" <<'ID'
#!/bin/bash
if [[ "$*" == "-un" ]]; then echo lean-deploy; else exec /usr/bin/id "$@"; fi
ID
chmod +x "$work/bin/id"
export PATH="$work/bin:$PATH"
cleanup() {
  # Only the sandbox controller and its verified supervisor PID are used.
  timeout 12 bash "$s/control-named.sh" stop >/dev/null 2>&1 || true
  rm -rf -- "$work"
}
trap cleanup EXIT
printf '%s\n' 'lean-center-qa.eun1' > "$s/named-id"
printf '%s\n' 'https://nl6smkdc-18081.eun1.devtunnels.ms' > "$s/named-origin"
printf 'synthetic data, never production\n' > "$data/secure.lc81"
printf 'initialized\n' > "$data/initialized"
for sha in "$baseline" "$candidate"; do
  mkdir -p "$root/$sha/.runtime" "$root/$sha/deploy/cloudcore"
  printf '%s\n' "$sha" > "$root/$sha/.qa-verified"
  printf '#!/bin/bash\nexit 0\n' > "$root/$sha/.runtime/node"
  chmod +x "$root/$sha/.runtime/node"
done
printf '%s 1\n' "$baseline" > "$s/active-release"
cat > "$s/supervise-named.sh" <<'SUPERVISOR'
#!/bin/bash
set -euo pipefail
s="$1"; release="$2"; data="$3"
if [[ -f "$release/fail-start" ]]; then
  printf 'FAILED_TEST\n' > "$s/status"
  exit 1
fi
printf '%s\n' "$$" > "$data/writer.lock"
stop() { rm -f -- "$data/writer.lock"; printf 'STOPPED\n' > "$s/status"; exit 0; }
trap stop TERM INT
printf 'READY\n' > "$s/status"
while true; do sleep 0.2; done
SUPERVISOR
cat > "$s/snapshot-release.sh" <<'SNAPSHOT'
#!/bin/bash
set -euo pipefail
s="$(dirname -- "$0")"
root="$(dirname -- "$s")"
test ! -e "$2/writer.lock"
backup="$(mktemp -d "$root/qa-backups/snapshot.XXXXXXXX")"
cp -a "$2/." "$backup/"
printf '%s\n' "$backup"
SNAPSHOT
cat > "$root/$candidate/deploy/cloudcore/check-update.sh" <<'CHECK'
#!/bin/bash
set -euo pipefail
release="$(cd -- "$(dirname -- "$0")/../.." && pwd)"
test -f "$1/secure.lc81"
test -f "$1/initialized"
test ! -f "$release/fail-check"
CHECK
original="$(sha256sum "$data/secure.lc81")"
ctl() { timeout --kill-after=5s 45s bash "$s/control-named.sh" "$@"; }
assert_baseline() {
  test "$(cat "$s/active-release")" = "$baseline 1"
  test "$(cat "$s/status")" = READY
  test -s "$data/writer.lock"
  test "$(sha256sum "$data/secure.lc81")" = "$original"
  kill -0 "$(cat "$s/supervisor.pid")"
}
ctl start >/dev/null
assert_baseline
touch "$root/$candidate/fail-check"
if ctl promote "$candidate" 2 > "$work/result"; then echo 'invalid backup check promoted' >&2; exit 1; fi
grep -Fx CLOUDCORE_QA_ERROR_UPDATE_REVERTED "$work/result"
assert_baseline
rm "$root/$candidate/fail-check"
touch "$root/$candidate/fail-start"
if ctl promote "$candidate" 2 > "$work/result"; then echo 'failed startup promoted' >&2; exit 1; fi
grep -Fx CLOUDCORE_QA_ERROR_UPDATE_REVERTED "$work/result"
assert_baseline
rm "$root/$candidate/fail-start"
ctl promote "$candidate" 2 > "$work/result"
grep -Fx CLOUDCORE_QA_PROMOTED "$work/result"
test "$(cat "$s/active-release")" = "$candidate 2"
test "$(cat "$s/status")" = READY
test "$(sha256sum "$data/secure.lc81")" = "$original"
test "$(find "$root/qa-backups" -name secure.lc81 -type f | wc -l)" -eq 3
ctl stop >/dev/null
test ! -e "$data/writer.lock"
echo CLOUDCORE_CONTROL_ROLLBACK_REHEARSAL_OK
