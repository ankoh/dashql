#!/bin/sh
# A harness for the bridge tests. It speaks the stream-json of Claude Code and works on the DashQL session through
# `dashql agent`, as a real agent does. The prompt picks what it does.
#   fake_harness.sh [--resume <id>] -- <prompt>

resume=""
while [ $# -gt 0 ]; do
    case "$1" in
        --resume) resume="$2"; shift 2 ;;
        --) shift; break ;;
        *) echo "unexpected argument: $1" >&2; exit 2 ;;
    esac
done
prompt="$1"
session="${resume:-fake-$$}"

# The texts must not need JSON escaping
text() {
    printf '{"type":"assistant","session_id":"%s","message":{"content":[{"type":"text","text":"%s"}]}}\n' "$session" "$1"
}
tool() {
    printf '{"type":"assistant","session_id":"%s","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"%s"}}]}}\n' "$session" "$1"
}
result() {
    printf '{"type":"result","subtype":"success","is_error":false,"session_id":"%s","result":"%s"}\n' "$session" "$1"
    exit 0
}

# Hooks report a session id before the conversation exists
printf '{"type":"system","subtype":"hook_started","session_id":"hook-%s"}\n' "$$"
if [ "$prompt" = "fail" ]; then
    echo "the model is overloaded" >&2
    exit 3
fi
printf '{"type":"system","subtype":"init","session_id":"%s"}\n' "$session"

case "$prompt" in
    count)
        # What the server gives every run
        [ -n "$DASHQL_SESSION" ] || result "DASHQL_SESSION is not set"
        [ "$DASHQL_AGENT_RUN" = "1" ] || result "DASHQL_AGENT_RUN is not set"
        [ -f AGENTS.md ] && [ -f CLAUDE.md ] && [ -f opencode.json ] || result "the working folder has no instructions"
        tool "dashql agent scripts"
        dashql agent scripts > /dev/null || result "scripts failed"
        tool "dashql agent catalog"
        dashql agent catalog | grep -q "CREATE TABLE orders" || result "the catalog has no orders"
        text "Writing q1"
        dashql agent edit q1 <<'EOF' > /dev/null || result "edit failed"
-- How many orders are there?
select count(*) from orders;
EOF
        dashql agent lint q1 | grep -q "no diagnostics" || result "lint failed"
        count=$(dashql agent run q1 | tail -n 1) || result "run failed"
        result "There are $count orders."
        ;;
    again)
        result "resumed $resume"
        ;;
    error)
        message=$(dashql agent read nope 2>&1)
        result "read exited with $?: $message"
        ;;
    serve)
        dashql agent serve > /dev/null 2>&1
        result "serve exited with $?"
        ;;
    wait)
        text "Waiting"
        # A child that a cancel has to stop as well
        sleep 60 &
        echo $! > sleep.pid
        wait
        result "the wait ended"
        ;;
    *)
        result "unknown prompt: $prompt"
        ;;
esac
