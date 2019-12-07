#!/bin/bash

PROJECT_ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )/../.."
SESSION="tigon"
EDITOR="nvim"
NODE_VERSION="v12.11.0"

mkdir -p "${PROJECT_ROOT}/tigon-core/build/debug"

[ -x "$(command -v tmux)" ] \
    && { echo "[ OK  ] Command: tmux"; } \
    || { echo "[ ERR ] Command: tmux"; exit 1; }

[ -x "$(command -v ${EDITOR})" ] \
    && { echo "[ OK  ] Command: ${EDITOR}"; } \
    || { echo "[ ERR ] Command: ${EDITOR}"; exit 1; }

set -x

tmux has-session -t $SESSION 2>/dev/null
if [ $? == 0 ]; then
    tmux kill-session -t ${SESSION}
fi

tmux new-session -d -s ${SESSION}
tmux new-window -t ${SESSION}:0 -k -n "core-vim" -c "${PROJECT_ROOT}/tigon-core"
tmux new-window -t ${SESSION}:1 -k -n "core-build" -c "${PROJECT_ROOT}/tigon-core/build/debug"
tmux new-window -t ${SESSION}:2 -k -n "wasm-build" -c "${PROJECT_ROOT}/tigon-dev"
tmux new-window -t ${SESSION}:3 -k -n "app-vim" -c "${PROJECT_ROOT}/tigon-app"
tmux new-window -t ${SESSION}:4 -k -n "app-srv" -c "${PROJECT_ROOT}/tigon-app"
tmux new-window -t ${SESSION}:5 -k -n "app-tests" -c "${PROJECT_ROOT}/tigon-app"

tmux send -t ${SESSION}:0 "${EDITOR}" C-m
tmux send -t ${SESSION}:3 "nvm use ${NODE_VERSION}" C-m
tmux send -t ${SESSION}:3 "${EDITOR}" C-m
tmux send -t ${SESSION}:4 "nvm use ${NODE_VERSION}" C-m
tmux send -t ${SESSION}:5 "nvm use ${NODE_VERSION}" C-m

tmux -2 attach-session -d
