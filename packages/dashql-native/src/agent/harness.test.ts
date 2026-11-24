import {chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";

import {describe, expect, test} from "vitest";

import {harnessArgs, isHarness, resolveLoginShellPath, resolveProgram, spawnHarness} from "./harness.js";
import type {ToolEvent} from "./readers.js";

function tempDir(): string {
    return mkdtempSync(path.join(process.env.TEST_TMPDIR ?? tmpdir(), "dashql-harness-"));
}

function script(dir: string, name: string, text: string): string {
    const file = path.join(dir, name);
    writeFileSync(file, text);
    chmodSync(file, 0o755);
    return file;
}

describe("the arguments of a harness", () => {
    test("pass the prompt as one argument after --", () => {
        const prompt = "say \"hi\"; rm -rf /";
        expect(harnessArgs("codex", {prompt, session: null, guide: "g"})).toEqual([
            "exec", "--json", "--skip-git-repo-check", "--sandbox", "workspace-write", "-c", "sandbox_workspace_write.network_access=true", "--", prompt,
        ]);
        // A prompt that looks like an option stays the prompt
        expect(harnessArgs("opencode", {prompt: "--help", session: null, guide: "g"})).toEqual(["run", "--format", "json", "--", "--help"]);
    });

    test("resume the session of the harness and give Claude Code the guide and its tools", () => {
        expect(harnessArgs("claude", {prompt: "next", session: "c-1", guide: "the guide"})).toEqual([
            "-p", "--output-format", "stream-json", "--verbose", "--append-system-prompt", "the guide",
            "--allowedTools", "Bash(dashql:*)", "Write(./input/*)", "Edit(./input/*)", "--resume", "c-1", "--", "next",
        ]);
        expect(harnessArgs("codex", {prompt: "next", session: "t-1", guide: "g"}).slice(-4)).toEqual(["resume", "t-1", "--", "next"]);
        expect(harnessArgs("opencode", {prompt: "next", session: "ses_1", guide: "g"})).toEqual(["run", "--format", "json", "--session", "ses_1", "--", "next"]);
    });

    test("know only the harnesses of the app", () => {
        expect(isHarness("claude")).toBe(true);
        expect(isHarness("sh")).toBe(false);
        expect(isHarness(undefined)).toBe(false);
    });
});

test("programs resolve on a PATH to executable files", () => {
    const dir = tempDir();
    const claude = script(dir, "claude", "#!/bin/sh\n");
    writeFileSync(path.join(dir, "codex"), "not executable");
    const searchPath = ["/nonexistent", dir].join(path.delimiter);
    expect(resolveProgram("claude", searchPath)).toBe(claude);
    expect(resolveProgram("codex", searchPath)).toBeNull();
    expect(resolveProgram("opencode", searchPath)).toBeNull();
    expect(resolveProgram(claude, "")).toBe(claude);
});

test("the PATH comes from the login shell between its markers, else from the process", async () => {
    const dir = tempDir();
    const shell = script(dir, "shell", "#!/bin/sh\necho 'Welcome!'\nprintf '__DASHQL_PATH__/opt/homebrew/bin:/usr/bin__DASHQL_PATH__'\n");
    expect(await resolveLoginShellPath({SHELL: shell, PATH: "/usr/bin"})).toBe("/opt/homebrew/bin:/usr/bin");
    const failing = script(dir, "failing", "#!/bin/sh\nexit 1\n");
    expect(await resolveLoginShellPath({SHELL: failing, PATH: "/usr/bin"})).toBe("/usr/bin");
    expect(await resolveLoginShellPath({PATH: "/bin"})).toBe("/bin");
});

describe("a run of a harness", () => {
    test("reads the lines of the harness and ends with its outcome", async () => {
        const dir = tempDir();
        const lines = [
            {type: "system", subtype: "init", session_id: "c-1"},
            {type: "assistant", message: {content: [{type: "tool_use", id: "t1", name: "Bash", input: {command: "dashql scripts"}}]}},
            {type: "user", message: {content: [{type: "tool_result", tool_use_id: "t1", content: "ok"}]}},
            {type: "result", subtype: "success", result: "Done"},
        ];
        const program = script(dir, "claude", `#!/bin/sh\npwd > cwd.txt\nprintf '%s\\n' '${lines.map(line => JSON.stringify(line)).join("' '")}'\n`);
        const tools: ToolEvent[] = [];
        const sessions: string[] = [];
        const run = spawnHarness({harness: "claude", program, args: [], cwd: dir, env: {PATH: "/usr/bin:/bin"}, sink: {tool: event => tools.push(event), session: id => sessions.push(id)}});
        expect(await run.done).toEqual({message: "Done", error: null, stopped: false});
        expect(sessions).toEqual(["c-1"]);
        expect(tools.map(tool => tool.event)).toEqual(["PreToolUse", "PostToolUse"]);
        expect(readFileSync(path.join(dir, "cwd.txt"), "utf8").trim()).toBe(dir);
    });

    test("tells a harness that failed with the end of its stderr", async () => {
        const dir = tempDir();
        const program = script(dir, "codex", "#!/bin/sh\necho 'error: unexpected argument' >&2\nexit 2\n");
        const run = spawnHarness({harness: "codex", program, args: [], cwd: dir, env: {}, sink: {tool: () => {}, session: () => {}}});
        expect((await run.done).error).toBe("The harness exited with code 2: error: unexpected argument");
    });

    test("tells a program that does not start", async () => {
        const dir = tempDir();
        const run = spawnHarness({harness: "codex", program: path.join(dir, "missing"), args: [], cwd: dir, env: {}, sink: {tool: () => {}, session: () => {}}});
        expect((await run.done).error).toMatch(/^Cannot start .*missing/);
    });

    test("stop kills the process group, the commands of the agent included", async () => {
        const dir = tempDir();
        // The harness and a command of its agent ignore SIGTERM, the kill after the grace ends them
        const program = script(dir, "opencode", `#!/bin/sh
trap '' TERM
sh -c 'trap "" TERM; echo $$ > child.pid; while true; do sleep 1; done' &
while true; do sleep 1; done
`);
        const run = spawnHarness({harness: "opencode", program, args: [], cwd: dir, env: {PATH: "/usr/bin:/bin"}, killGraceMs: 200, sink: {tool: () => {}, session: () => {}}});
        const pidFile = path.join(dir, "child.pid");
        for (let i = 0; i < 100 && !existsSync(pidFile); ++i) await new Promise(resolve => setTimeout(resolve, 50));
        const child = Number(readFileSync(pidFile, "utf8"));
        run.stop();
        const outcome = await run.done;
        expect(outcome.stopped).toBe(true);
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(() => process.kill(child, 0)).toThrow();
    });
});
