import {describe, expect, test} from "vitest";

import {createReader, errorMessage, statusLine, toolStatus, type AgentHarness, type ToolEvent} from "./readers.js";

/// Read the lines of a harness, the tools and sessions it told and its outcome
function read(harness: AgentHarness, lines: unknown[], exitCode: number | null = 0, stderr = "", folder = "/w/x") {
    const reader = createReader(harness, folder);
    const tools: ToolEvent[] = [];
    const sessions: string[] = [];
    for (const line of lines) reader.line(typeof line === "string" ? line : JSON.stringify(line), {tool: event => tools.push(event), session: id => sessions.push(id)});
    return {tools, sessions, outcome: reader.finish(exitCode, stderr)};
}

describe("the reader of Claude Code", () => {
    test("tells the session of init, the steps of the tools and the result", () => {
        const {tools, sessions, outcome} = read("claude", [
            // Hooks run before the conversation exists
            {type: "system", subtype: "hook_started", session_id: "c-0"},
            {type: "system", subtype: "init", session_id: "c-1"},
            {type: "assistant", message: {content: [
                {type: "text", text: "Looking at the schema"},
                {type: "tool_use", id: "toolu_1", name: "Bash", input: {command: "dashql scripts", description: "list"}},
                {type: "tool_use", id: "toolu_2", name: "Write", input: {file_path: "/w/x/input/orders.sql", content: "select 1"}},
            ]}},
            {type: "user", message: {content: [{type: "tool_result", tool_use_id: "toolu_1", content: "orders.sql"}]}},
            {type: "user", message: {content: [{type: "tool_result", tool_use_id: "toolu_2", content: [{type: "text", text: "Permission denied\nmore"}], is_error: true}]}},
            "not json",
            {type: "result", subtype: "success", is_error: false, result: "There are 42 orders.", session_id: "c-1"},
        ]);
        expect(sessions).toEqual(["c-1"]);
        expect(tools).toEqual([
            {event: "PreToolUse", status: "dashql scripts", toolUseId: "toolu_1"},
            {event: "PreToolUse", status: "Write input/orders.sql", toolUseId: "toolu_2"},
            {event: "PostToolUse", status: "dashql scripts", toolUseId: "toolu_1"},
            {event: "PostToolUse", status: "Write input/orders.sql", toolUseId: "toolu_2", error: "Permission denied"},
        ]);
        expect(outcome).toEqual({message: "There are 42 orders.", error: null});
    });

    test("tells why a run failed", () => {
        expect(read("claude", [{type: "result", subtype: "error_max_turns", is_error: true}], 1).outcome.error).toBe("The run ended with error_max_turns");
        // A session that cannot be resumed fails before init, stderr says why
        const failed = read("claude", [{type: "result", subtype: "error_during_execution", is_error: true, session_id: "c-0"}], 1, "No conversation found with session ID: c-0\n");
        expect(failed.sessions).toEqual([]);
        expect(failed.outcome.error).toBe("No conversation found with session ID: c-0");
        expect(read("claude", [{type: "result", subtype: "success", is_error: true, result: "API Error: 529 overloaded"}], 1).outcome.error).toBe("API Error: 529 overloaded");
        expect(read("claude", [], 2, "error: unknown option '--bad'\n").outcome.error).toBe("The harness exited with code 2: error: unknown option '--bad'");
        expect(read("claude", [], null).outcome.error).toBe("The harness was killed");
    });
});

describe("the reader of Codex", () => {
    test("tells the thread, the commands, the changes of files and the last message", () => {
        const {tools, sessions, outcome} = read("codex", [
            {type: "thread.started", thread_id: "t-1"},
            {type: "turn.started"},
            {type: "item.started", item: {id: "item_0", type: "command_execution", command: "bash -lc 'dashql catalog'", status: "in_progress"}},
            {type: "item.completed", item: {id: "item_0", type: "command_execution", command: "bash -lc 'dashql catalog'", aggregated_output: "", exit_code: 0, status: "completed"}},
            {type: "item.started", item: {id: "item_1", type: "command_execution", command: "/bin/bash -lc \"dashql run orders\"", status: "in_progress"}},
            {type: "item.completed", item: {id: "item_1", type: "command_execution", command: "/bin/bash -lc \"dashql run orders\"", exit_code: 1, status: "failed"}},
            {type: "item.completed", item: {id: "item_2", type: "file_change", changes: [{path: "/w/x/notes.md", kind: "add"}], status: "completed"}},
            {type: "item.completed", item: {id: "item_3", type: "reasoning", text: "thinking"}},
            {type: "item.completed", item: {id: "item_4", type: "agent_message", text: "Wrote orders.\nIt counts them."}},
            {type: "turn.completed", usage: {}},
        ]);
        expect(sessions).toEqual(["t-1"]);
        expect(tools).toEqual([
            {event: "PreToolUse", status: "dashql catalog", toolUseId: "item_0"},
            {event: "PostToolUse", status: "dashql catalog", toolUseId: "item_0"},
            {event: "PreToolUse", status: "dashql run orders", toolUseId: "item_1"},
            {event: "PostToolUse", status: "dashql run orders", toolUseId: "item_1", error: "exit code 1"},
            {event: "PreToolUse", status: "Edit notes.md", toolUseId: "item_2"},
            {event: "PostToolUse", status: "Edit notes.md", toolUseId: "item_2"},
        ]);
        expect(outcome).toEqual({message: "Wrote orders.\nIt counts them.", error: null});
    });

    test("tells why a turn failed, also from the JSON body of a failed API call", () => {
        expect(read("codex", [{type: "turn.failed", error: {message: "rate limited"}}], 1).outcome.error).toBe("rate limited");
        const api = JSON.stringify({type: "error", status: 400, error: {type: "invalid_request_error", message: "The model is not supported"}});
        expect(read("codex", [{type: "turn.failed", error: {message: api}}], 1).outcome.error).toBe("The model is not supported");
        expect(read("codex", [{type: "error", message: api}], 1).outcome.error).toBe("The model is not supported");
        expect(read("codex", [], 2, "error: unexpected argument\n").outcome.error).toBe("The harness exited with code 2: error: unexpected argument");
        // An error that Codex recovered from ends no turn
        expect(read("codex", [{type: "error", message: "Reconnecting... 1/5"}, {type: "turn.completed"}], 0).outcome.error).toBeNull();
    });
});

describe("the reader of opencode", () => {
    test("tells the session, the tools and the text of the last step without tools", () => {
        const session = "ses_494719016ffe85dkDMj0FPRbHK";
        const event = (type: string, part: object) => ({type, sessionID: session, part});
        const {tools, sessions, outcome} = read("opencode", [
            event("step_start", {type: "step-start"}),
            event("text", {type: "text", text: "Looking at the schema"}),
            event("tool_use", {type: "tool", tool: "bash", callID: "call_1", state: {status: "completed", input: {command: "dashql catalog"}}}),
            event("tool_use", {type: "tool", tool: "bash", callID: "call_2", state: {status: "error", input: {command: "rm -rf /"}, error: "denied by the rules"}}),
            event("text", {type: "text", text: "Let me look."}),
            event("step_finish", {type: "step-finish", reason: "tool-calls"}),
            event("step_start", {type: "step-start"}),
            event("text", {type: "text", text: "There are 42 orders."}),
            event("step_finish", {type: "step-finish", reason: "stop"}),
        ]);
        expect(sessions).toEqual([session]);
        expect(tools).toEqual([
            {event: "PreToolUse", status: "dashql catalog", toolUseId: "call_1"},
            {event: "PostToolUse", status: "dashql catalog", toolUseId: "call_1"},
            {event: "PreToolUse", status: "rm -rf /", toolUseId: "call_2"},
            {event: "PostToolUse", status: "rm -rf /", toolUseId: "call_2", error: "denied by the rules"},
        ]);
        expect(outcome).toEqual({message: "There are 42 orders.", error: null});
    });

    test("tells the error of a run", () => {
        const error = {type: "error", sessionID: "ses_1", error: {name: "APIError", data: {message: "Rate limit exceeded"}}};
        expect(read("opencode", [error], 1).outcome.error).toBe("Rate limit exceeded");
    });
});

test("status lines are the first line, cut, with paths relative to the folder", () => {
    expect(statusLine("  first\nsecond")).toBe("first");
    expect(statusLine("x".repeat(200))).toHaveLength(160);
    expect(toolStatus("Bash", {command: "cd /w/x && dashql run orders"}, "/w/x")).toBe("dashql run orders");
    expect(toolStatus("Grep", {pattern: "orders", path: "/w/x"}, "/w/x")).toBe("Grep orders");
    expect(toolStatus("Edit", {file_path: "/w/x/input/a.sql"}, "/w/x")).toBe("Edit input/a.sql");
    expect(toolStatus("apply_patch", {command: "*** Begin Patch\n*** Add File: /w/x/a.sql\n*** End Patch"}, "/w/x")).toBe("apply_patch a.sql");
    expect(toolStatus("TodoWrite", {todos: []}, "/w/x")).toBe("TodoWrite");
    expect(errorMessage("plain")).toBe("plain");
});
