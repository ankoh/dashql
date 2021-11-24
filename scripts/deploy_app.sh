#!/usr/bin/env bash

set -ex

PROJECT_ROOT="$(cd $(dirname "$BASH_SOURCE[0]") && cd .. && pwd)" &> /dev/null
PAGES_DIR=${PROJECT_ROOT}/worktrees/gh-pages

mkdir -p ${PROJECT_ROOT}/worktrees
if [ ! -d ${PAGES_DIR} ]; then
    echo "[ RUN ] Add worktree origin/gh-pages"
    git worktree add ${PAGES_DIR} origin/gh-pages
fi

DEFAULT_BRANCH="master"
CURRENT_BRANCH=${1:-master}

cd ${PAGES_DIR}
git fetch origin gh-pages
git reset --hard origin/gh-pages

if [ "${CURRENT_BRANCH}" = "${DEFAULT_BRANCH}" ]; then
    echo "[ RUN ] Install @dashql/core to ${PAGES_DIR}/"

    find ${PAGES_DIR} \
        -mindepth 1 \
        -maxdepth 1 \
        -type d \
        -not -name branches \
        -not -name data \
        -exec echo rm -rf '{}' \;

    cp -r ${PROJECT_ROOT}/packages/core/build/app-prod/* ${PAGES_DIR}
else
    TARGET_DIR="${PAGES_DIR}/branches/${CURRENT_BRANCH}"
    echo "[ RUN ] Install @dashql/core to ${TARGET_DIR}/"

    rm -rf ${TARGET_DIR}
    mkdir -p ${PAGES_DIR}/branches
    cp -r ${PROJECT_ROOT}/packages/core/build/release ${TARGET_DIR}
fi

git config --global user.name 'github-actions[bot]'
git config --global user.email '41898282+github-actions[bot]@users.noreply.github.com'
git add -A .
git commit --amend --reset-author -m "Deploy app"
git push origin HEAD:gh-pages --force
