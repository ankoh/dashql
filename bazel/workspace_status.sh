#!/usr/bin/env bash
set -euo pipefail

VERSION="0.0.1"
COMMIT="unknown"

if describe=$(git describe --tags --long 2>/dev/null); then
  if tag=$(git describe --tags --abbrev=0 2>/dev/null); then
    tag=${tag#v}
    IFS='.' read -r major minor patch _ <<<"$tag"
    major=${major:-0}
    minor=${minor:-0}
    patch=${patch:-1}
  else
    major=0
    minor=0
    patch=1
  fi

  IFS='-' read -r _tag iteration ghash _ <<<"$describe"
  iteration=${iteration:-0}
  ghash=${ghash:-gunknown}

  if [[ "$iteration" =~ ^[0-9]+$ ]] && (( iteration > 0 )); then
    VERSION="${major}.${minor}.$((patch + 1))-dev.${iteration}"
  else
    VERSION="${major}.${minor}.${patch}"
  fi

  COMMIT=${ghash#g}
fi

echo "STABLE_DASHQL_VERSION ${VERSION}"
echo "STABLE_DASHQL_GIT_COMMIT ${COMMIT}"
echo "REPO_URL $(git remote get-url origin 2>/dev/null || true)"
echo "COMMIT_SHA $(git rev-parse HEAD 2>/dev/null || true)"
echo "BRANCH_NAME $(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
