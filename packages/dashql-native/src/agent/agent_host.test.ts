import {chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";

import {afterEach, describe, expect, test} from "vitest";

import {AgentHost, type AgentCall, type AgentPage} from "./agent_host.js";
import type {AgentEvent} from "./readers.js";

/// The Node of the test, the fake commands run on it
const NODE = path.resolve(process.env.JS_BINARY__NODE_BINARY ?? process.execPath);

function tempDir(): string {
    return mkdtempSync(path.join(process.env.TEST_TMPDIR ?? tmpdir(), "dashql-agent-"));
}

function script(dir: string, name: string, text: string): string {
    const file = path.join(dir, name);
    writeFileSync(file, text);
    chmodSync(file, 0o755);
    return file;
}

/// A `dashql` that prints a guide and passes every other command as a call to the app, like the command of the app
function fakeDashQL(dir: string): string {
    return script(dir, "dashql", `#!${NODE}
const args = process.argv.slice(2);
if (args[0] === "guide") { console.log("THE GUIDE"); process.exit(0); }
if (args[0] !== "--session") { console.error("no session"); process.exit(2); }
const session = JSON.parse(require("fs").readFileSync(args[1], "utf8"));
fetch(session.url + "/v1/call", {
    method: "POST",
    headers: {authorization: "Bearer " + session.token, "content-type": "application/json"},
    body: JSON.stringify({workbookId: session.workbookId, command: args[2], args: {rest: args.slice(3)}, input: null}),
}).then(async response => {
    if (response.status !== 200) { console.error("error: " + await response.text()); process.exit(2); }
    let exit = 1;
    for (const line of (await response.text()).split("\\n").filter(Boolean)) {
        const part = JSON.parse(line);
        if (part.out) process.stdout.write(part.out);
        if (part.err) process.stderr.write(part.err);
        if (part.exit !== undefined) exit = part.exit;
    }
    process.exit(exit);
});
`);
}

/// A Claude Code that calls \`dashql scripts\` and answers with its output, or sleeps for \`sleep\`
function fakeClaude(dir: string): void {
    script(dir, "claude", `#!/bin/sh
printf '%s\\n' "$@" > "$PWD/args.txt"
case "$*" in *sleep*) trap '' TERM; while true; do sleep 1; done;; esac
echo '{"type":"system","subtype":"init","session_id":"c-1"}'
echo '{"type":"assistant","message":{"content":[{"type":"text","text":"I list the scripts."},{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"dashql scripts"}},{"type":"tool_use","id":"t2","name":"Bash","input":{"command":"ls"}}]}}'
OUT=$(dashql scripts 2>&1)
echo '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"ok"},{"type":"tool_result","tool_use_id":"t2","content":"ok"}]}}'
printf '{"type":"result","subtype":"success","result":"scripts: %s"}\\n' "$OUT"
`);
}

/// A page that records the events and answers every call with the names of the scripts
class FakePage implements AgentPage {
    events: AgentEvent[] = [];
    calls: AgentCall[] = [];
    host: AgentHost | null = null;
    #stopped: Array<() => void> = [];

    event(_workbookId: string, event: AgentEvent): void {
        this.events.push(event);
        if (event.event === "Stop") for (const resolve of this.#stopped.splice(0)) resolve();
    }

    call(call: AgentCall): void {
        this.calls.push(call);
        this.host!.reply(this, {callId: call.callId, out: "orders.sql"});
        this.host!.reply(this, {callId: call.callId, exit: 0});
    }

    cancelCall(): void {}

    stopped(): Promise<void> {
        return new Promise(resolve => this.#stopped.push(resolve));
    }
}

let host: AgentHost | null = null;

afterEach(async () => {
    await host?.close();
    host = null;
});

function setup() {
    const dir = tempDir();
    const bin = path.join(dir, "harnesses");
    const root = path.join(dir, "agent");
    mkdirSync(bin);
    fakeClaude(bin);
    host = new AgentHost({
        root,
        dashqlBinary: fakeDashQL(dir),
        env: {PATH: "/usr/bin:/bin", HOME: dir},
        searchPath: async () => [bin, "/usr/bin", "/bin"].join(path.delimiter),
        killGraceMs: 200,
    });
    const page = new FakePage();
    page.host = host;
    return {dir, root, host, page};
}

describe("the agent host", () => {
    test("tells which harnesses the machine has", async () => {
        const {host} = setup();
        expect(await host.info()).toEqual({harnesses: [
            {id: "claude", available: true},
            {id: "codex", available: false},
            {id: "opencode", available: false},
        ]});
    });

    test("runs a question in the folder of the workbook, its agent calls the page, the next question resumes", async () => {
        const {root, host, page} = setup();
        let stopped = page.stopped();
        await host.ask({workbookId: "w1", harness: "claude", prompt: "the prompt"}, page);
        await stopped;
        expect(page.events).toEqual([
            // The page tells the dashql commands from their calls
            {event: "Say", text: "I list the scripts."},
            {event: "PreToolUse", status: "ls", toolUseId: "t2"},
            {event: "PostToolUse", status: "ls", toolUseId: "t2"},
            {event: "Stop", message: "scripts: orders.sql", error: null},
        ]);
        expect(page.calls).toEqual([{callId: 1, workbookId: "w1", command: "scripts", args: {rest: []}, input: null}]);

        const folder = path.join(root, "workbooks", "w1");
        const session = JSON.parse(readFileSync(path.join(folder, "session.json"), "utf8"));
        expect(session).toEqual({url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+$/), token: expect.stringMatching(/^[0-9a-f]{64}$/), workbookId: "w1"});
        expect(statSync(path.join(folder, "session.json")).mode & 0o777).toBe(0o600);
        expect(statSync(folder).mode & 0o777).toBe(0o700);
        expect(readFileSync(path.join(folder, "bin", "dashql"), "utf8")).toContain(`--session '${path.join(folder, "session.json")}' "$@"`);
        expect(readFileSync(path.join(folder, "AGENTS.md"), "utf8")).toBe("THE GUIDE\n");
        expect(readFileSync(path.join(folder, "CLAUDE.md"), "utf8")).toContain("system prompt");
        expect(JSON.parse(readFileSync(path.join(folder, "opencode.json"), "utf8")).permission.bash).toEqual({"*": "deny", "dashql *": "allow"});
        expect(JSON.parse(readFileSync(path.join(folder, "state.json"), "utf8"))).toEqual({sessions: {claude: "c-1"}});
        const args = readFileSync(path.join(folder, "args.txt"), "utf8");
        expect(args.split("\n")).not.toContain("--resume");
        // Claude Code has the guide in its system prompt
        expect(args).toContain("--append-system-prompt\nTHE GUIDE");

        // A file of an earlier question is gone, the next question resumes the session of the harness
        writeFileSync(path.join(folder, "input", "old.sql"), "select 0");
        stopped = page.stopped();
        await host.ask({workbookId: "w1", harness: "claude", prompt: "and per day?"}, page);
        await stopped;
        expect(readdirSync(path.join(folder, "input"))).toEqual([]);
        const resumed = readFileSync(path.join(folder, "args.txt"), "utf8").split("\n");
        expect(resumed.slice(resumed.indexOf("--resume"), resumed.indexOf("--resume") + 4)).toEqual(["--resume", "c-1", "--", "and per day?"]);
    });

    test("runs one question at a time per workbook and stops a question", async () => {
        const {host, page} = setup();
        const stopped = page.stopped();
        await host.ask({workbookId: "w1", harness: "claude", prompt: "sleep"}, page);
        await expect(host.ask({workbookId: "w1", harness: "claude", prompt: "x"}, page)).rejects.toThrow(/still works/);
        await host.stop("w1");
        await stopped;
        expect(page.events.at(-1)).toEqual({event: "Stop", message: null, error: null, interrupted: true});
    });

    test("a page that went away stops its questions", async () => {
        const {host, page} = setup();
        const stopped = page.stopped();
        await host.ask({workbookId: "w1", harness: "claude", prompt: "sleep"}, page);
        await host.detach(page);
        await stopped;
        expect(page.events.at(-1)).toEqual({event: "Stop", message: null, error: null, interrupted: true});
    });

    test("refuses unknown workbooks, harnesses and harnesses that the machine lacks", async () => {
        const {host, page} = setup();
        await expect(host.ask({workbookId: "../x", harness: "claude", prompt: "x"}, page)).rejects.toThrow(/workbook id/);
        await expect(host.ask({workbookId: "w1", harness: "sh" as "claude", prompt: "x"}, page)).rejects.toThrow(/Unknown harness/);
        await expect(host.ask({workbookId: "w1", harness: "codex", prompt: "x"}, page)).rejects.toThrow(/codex is not installed/);
        expect(page.events).toEqual([]);
        // A refused question holds no workbook
        await expect(host.writeFile(page, {workbookId: "w1", kind: "chart", name: "x.png", data: new Uint8Array()})).rejects.toThrow(/No question runs/);
    });

    test("writes the files of a question into its folder and forgets a workbook", async () => {
        const {root, host, page} = setup();
        const data = new Uint8Array([1, 2, 3]);
        await expect(host.writeFile(page, {workbookId: "w1", kind: "chart", name: "orders.png", data})).rejects.toThrow(/No question runs/);
        const stopped = page.stopped();
        await host.ask({workbookId: "w1", harness: "claude", prompt: "sleep"}, page);
        expect(await host.writeFile(page, {workbookId: "w1", kind: "chart", name: "orders.png", data})).toBe("charts/orders.png");
        expect([...readFileSync(path.join(root, "workbooks", "w1", "charts", "orders.png"))]).toEqual([1, 2, 3]);
        await expect(host.writeFile(page, {workbookId: "w1", kind: "chart", name: "../x.png", data})).rejects.toThrow(/file name/);
        await expect(host.writeFile(page, {workbookId: "w1", kind: "script", name: "x.sql", data})).rejects.toThrow(/file kind/);
        // Another page may not write
        await expect(host.writeFile(new FakePage(), {workbookId: "w1", kind: "chart", name: "x.png", data})).rejects.toThrow(/No question runs/);
        await host.forget("w1");
        await stopped;
        expect(existsSync(path.join(root, "workbooks", "w1"))).toBe(false);
    });

    test("keeps the conversation of the page and forgets it with the sessions", async () => {
        const {root, host, page} = setup();
        expect(await host.readConversation("w1")).toBeNull();
        await Promise.all([
            host.writeConversation("w1", {harness: "claude", turns: [{turnId: 1}]}),
            host.writeConversation("w1", {harness: "claude", turns: [{turnId: 1}, {turnId: 2}]}),
        ]);
        expect(await host.readConversation("w1")).toEqual({harness: "claude", turns: [{turnId: 1}, {turnId: 2}]});
        const file = path.join(root, "workbooks", "w1", "conversation.json");
        expect(statSync(file).mode & 0o777).toBe(0o600);
        await expect(host.writeConversation("w1", "text")).rejects.toThrow(/Rejected conversation/);
        await expect(host.writeConversation("../w1", {turns: []})).rejects.toThrow(/workbook id/);
        await expect(host.writeConversation("w1", {turns: ["x".repeat(5 * 1024 * 1024)]})).rejects.toThrow(/Rejected conversation/);
        const stopped = page.stopped();
        await host.ask({workbookId: "w1", harness: "claude", prompt: "the prompt"}, page);
        await stopped;
        expect(existsSync(path.join(root, "workbooks", "w1", "state.json"))).toBe(true);
        await host.forget("w1");
        expect(await host.readConversation("w1")).toBeNull();
        expect(existsSync(path.join(root, "workbooks", "w1"))).toBe(false);
    });
});
