#!/bin/bash
set -euo pipefail
umask 077
[[ "$(id -un)" == lean-deploy && "$(id -u)" != 0 ]] || exit 1
s="$(cd -- "$(dirname -- "$(realpath -- "$0")")" && pwd)"
root="$(dirname -- "$s")"
baseline=8f1cf40db232d0fc5afafe386245617a117f77ee
data="$root/$baseline/data"
active="$s/active-release"
origin=https://nl6smkdc-18081.eun1.devtunnels.ms
[[ "$(cat "$s/named-id")" == lean-center-qa.eun1 && "$(cat "$s/named-origin")" == "$origin" ]] || exit 1
[[ ! -L "$data" && -f "$data/secure.lc81" && -f "$data/initialized" ]] || exit 1
op="$1"
if [[ "$op" == promote ]]; then
  [[ $# == 3 && "$2" =~ ^[a-f0-9]{40}$ && "$3" =~ ^[1-9][0-9]{0,8}$ ]] || exit 1
else
  [[ $# == 1 && "$op" =~ ^(start|stop|restart|snapshot)$ ]] || exit 1
fi

exec 9>"$s/control.lock"
flock -w 90 9
sha="$baseline"
sequence=0
if [[ -f "$active" ]]; then
  read -r sha sequence < "$active"
fi
[[ "$sha" =~ ^[a-f0-9]{40}$ && "$sequence" =~ ^(0|[1-9][0-9]{0,8})$ ]] || exit 1

release_valid() {
  [[ ! -L "$root/$1" && -x "$root/$1/.runtime/node" &&
    -f "$root/$1/.qa-verified" && "$(cat "$root/$1/.qa-verified")" == "$1" ]]
}
release_valid "$sha"

running() {
  local state
  [[ "$1" =~ ^[0-9]+$ ]] && kill -0 "$1" 2>/dev/null || return 1
  state="$(ps -o stat= -p "$1")" || return 1
  [[ -n "$state" && "$state" != Z* ]]
}

stop_live() {
  local pid attempt
  if [[ -f "$s/supervisor.pid" ]]; then
    read -r pid < "$s/supervisor.pid"
    if running "$pid"; then
      tr '\0' '\n' < "/proc/$pid/cmdline" | grep -Fx -e "$s/supervise.sh" -e "$s/supervise-named.sh" >/dev/null || return 1
      kill -TERM "$pid" || return 1
      for attempt in {1..45}; do
        running "$pid" || break
        sleep 1
      done
      if running "$pid"; then echo STOP_TIMEOUT; return 1; fi
      printf 'QA_PROCESS_STOPPED %s\n' "$pid"
    fi
  fi
  [[ ! -e "$data/writer.lock" ]]
}

start_live() {
  local release="$root/$1" status pid attempt
  [[ ! -e "$data/writer.lock" ]] || return 1
  printf '%s\n' STARTING > "$s/status" || return 1
  nohup setsid bash "$s/supervise-named.sh" "$s" "$release" "$data" 9>&- \
    > "$s/supervisor.log" 2>&1 < /dev/null &
  pid="$!"
  printf '%s\n' "$pid" > "$s/supervisor.pid" || return 1
  for attempt in {1..95}; do
    status="$(cat "$s/status")" || return 1
    case "$status" in
      READY) printf 'QA_PROCESS_STARTED %s\nNAMED_HTTPS_READY %s\n' "$pid" "$origin"; return 0 ;;
      FAILED_*|STOPPED) printf '%s\n' "$status"; return 1 ;;
    esac
    sleep 1
  done
  echo START_TIMEOUT
  return 1
}

save_active() {
  printf '%s %s\n' "$1" "$2" > "$active.new" && mv -f -- "$active.new" "$active"
}

was_running=0
if [[ -f "$s/supervisor.pid" ]] && running "$(cat "$s/supervisor.pid")"; then was_running=1; fi

if [[ "$op" == promote ]]; then
  candidate="$2"
  next_sequence="$3"
  if (( next_sequence < sequence )); then echo CLOUDCORE_QA_OLDER_RUN; exit 0; fi
  if [[ "$candidate" == "$sha" && "$was_running" == 1 && "$(cat "$s/status")" == READY ]]; then
    save_active "$sha" "$next_sequence"
    echo CLOUDCORE_QA_ALREADY_ACTIVE
    exit 0
  fi
  release_valid "$candidate" || { echo CLOUDCORE_QA_ERROR_CANDIDATE; exit 1; }
  [[ -f "$root/$candidate/deploy/cloudcore/check-update.sh" ]] || exit 1
  recover_interrupted_update() {
    trap - HUP INT TERM
    if stop_live && save_active "$sha" "$sequence" && (( was_running )); then
      start_live "$sha" || true
    fi
    exit 1
  }
  trap recover_interrupted_update HUP INT TERM
  stop_live || { echo CLOUDCORE_QA_ERROR_STOP; exit 1; }
  backup=''
  if backup="$(/bin/bash "$s/snapshot-release.sh" "$sha" "$data")" &&
    /bin/bash "$root/$candidate/deploy/cloudcore/check-update.sh" "$backup" "$candidate" "$origin" &&
    save_active "$candidate" "$next_sequence"; then
    if start_live "$candidate"; then
      echo CLOUDCORE_QA_PROMOTED
      exit 0
    fi
    stop_live || { echo CLOUDCORE_QA_ERROR_CANDIDATE_STOP; exit 1; }
    save_active "$sha" "$sequence" || { echo CLOUDCORE_QA_ERROR_POINTER; exit 1; }
  fi
  if (( was_running )); then
    start_live "$sha" || { echo CLOUDCORE_QA_ERROR_ROLLBACK; exit 1; }
  fi
  echo CLOUDCORE_QA_ERROR_UPDATE_REVERTED
  exit 1
fi

if [[ "$op" == start ]]; then
  if (( was_running )); then echo ALREADY_RUNNING; exit 1; fi
  start_live "$sha"
  exit
fi

stop_live
if [[ "$op" == stop ]]; then exit 0; fi
snapshot_rc=0
if [[ "$op" == snapshot ]]; then
  if result="$(/bin/bash "$s/snapshot-release.sh" "$sha" "$data")"; then
    printf 'QA_BACKUP_PATH=%s\n' "$result"
  else
    snapshot_rc=1
    echo QA_BACKUP_FAILED >&2
  fi
  if (( ! was_running )); then exit "$snapshot_rc"; fi
fi
start_live "$sha"
exit "$snapshot_rc"
