#!/usr/bin/env bash
# Run one Bazel command of an agent under resource governance:
# - up to MAX_SLOTS Bazel commands at once across all worktrees, each holds a slot,
# - a command that runs the browser tests (test_chromium, test_firefox, coverage, or a whole package pattern of the
#   app) also holds the one browser slot, so only one browser suite runs at a time,
# - a command starts only while the machine has room: the 1-minute load below MAX_LOAD and at least MIN_FREE_GB of
#   available memory, otherwise it waits and checks again,
# - each run gets a capped JVM, few jobs, one local test job, a share of RAM and CPUs, and the tests few workers of
#   their own (vitest workers, browser shards), which Bazel's caps don't see,
# - the shared disk cache, so worktrees reuse each other's outputs,
# - the server exits after 2 idle minutes, so idle servers of worktrees don't pile up.
# This script holds the locks on its own descriptors and closes them for Bazel, so the forked Bazel server can't
# inherit a lock and hold it for as long as it lives.
# Usage: bazel-gov.sh <command> [args...]   e.g. bazel-gov.sh test //packages/dashql-core-runtime/...
set -uo pipefail
MAX_SLOTS=3
MAX_LOAD=16
MIN_FREE_GB=6
DIR=/tmp/claude-1000/dashql-bazel-slots
mkdir -p "$DIR"
cmd="$1"; shift

browser=0
for a in "$@"; do
    case "$a" in *test_chromium*|*test_firefox*|*test_webkit*|*coverage_chromium*|*dashql-app/...*|*dashql-app:all*|//...) browser=1 ;; esac
done
test_env=()
if [ "$cmd" = test ] || [ "$cmd" = coverage ]; then
    test_env=(--test_env=VITEST_MAX_WORKERS=3 --test_env=DASHQL_BROWSER_TEST_SHARDS=2)
fi

room() {
    local load free
    load=$(cut -d' ' -f1 /proc/loadavg)
    free=$(awk '/MemAvailable/ {print int($2/1048576)}' /proc/meminfo)
    awk -v l="$load" -v m="$MAX_LOAD" 'BEGIN { exit !(l < m) }' && [ "$free" -ge "$MIN_FREE_GB" ]
}

# Take the locks this run needs, on descriptors 8 (browser) and 9 (slot); succeed only if all are free
take() {
    if [ "$browser" -eq 1 ]; then
        exec 8>"$DIR/browser"
        flock -n 8 || { exec 8>&-; return 1; }
    fi
    for slot in $(seq 1 "$MAX_SLOTS"); do
        exec 9>"$DIR/slot$slot"
        if flock -n 9; then return 0; fi
        exec 9>&-
    done
    [ "$browser" -eq 1 ] && exec 8>&-
    return 1
}

waited=0
until room && take; do
    if [ "$waited" -eq 0 ]; then echo "bazel-gov: waiting for room (load $(cut -d' ' -f1 /proc/loadavg))" >&2; fi
    waited=1
    sleep 20
done
# query, cquery, aquery, mod, info and similar take no build flags
build_flags=()
case "$cmd" in
    build|test|run|coverage) build_flags=(--jobs=4 --local_test_jobs=1
        --local_resources=memory=HOST_RAM*.2 --local_resources=cpu=HOST_CPUS*.25
        --disk_cache="$HOME/.cache/bazel-disk-dashql") ;;
esac
bazel --host_jvm_args=-Xmx2g --max_idle_secs=120 "$cmd" "${build_flags[@]}" "${test_env[@]}" "$@" 8>&- 9>&-
