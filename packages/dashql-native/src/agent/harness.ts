// The harnesses that the app runs headless for a question: their programs, their arguments and the processes, see
// docs/design/agent_integration.md. Nothing here needs Electron, //tests/agents runs it with real harnesses.
import {spawn, type ChildProcess} from "node:child_process";
import {accessSync, constants, statSync} from "node:fs";
import path from "node:path";

import {createReader, type AgentHarness, type ReaderOutcome, type ReaderSink} from "./readers.js";

/// A harness that the app knows: its id and the program on the PATH, the page names it
export interface HarnessInfo {
    id: AgentHarness;
    program: string;
}

/// The harnesses, the renderer picks one by its id and never passes a command
export const HARNESSES: readonly HarnessInfo[] = [
    {id: "claude", program: "claude"},
    {id: "codex", program: "codex"},
    {id: "opencode", program: "opencode"},
];

export function isHarness(value: unknown): value is AgentHarness {
    return HARNESSES.some(harness => harness.id === value);
}

export function harnessInfo(harness: AgentHarness): HarnessInfo {
    const info = HARNESSES.find(candidate => candidate.id === harness);
    if (info === undefined) throw new Error(`Unknown harness ${harness}`);
    return info;
}

/// The folder in the folder of a workbook that Claude Code may write: it writes the texts of scripts there and passes
/// them with `--file`. Emptied at the start of every turn.
export const INPUT_FOLDER = "input";

/// The arguments of a run of a harness after its program. The prompt is one argument after `--`, never a shell word,
/// and a prompt that starts with `-` stays the prompt.
/// - `session` resumes the session of the harness that the last question of the workbook left
/// - `guide` is the system prompt of Claude Code: the guide of DashQL, which outranks the CLAUDE.md files of the user
export function harnessArgs(harness: AgentHarness, {prompt, session, guide}: {prompt: string; session: string | null; guide: string}): string[] {
    switch (harness) {
        case "claude":
            return [
                "-p", "--output-format", "stream-json", "--verbose",
                "--append-system-prompt", guide,
                // `dashql` and the files of the input folder without asking, anything else is refused: -p never asks
                "--allowedTools", "Bash(dashql:*)", `Write(./${INPUT_FOLDER}/*)`, `Edit(./${INPUT_FOLDER}/*)`,
                ...(session !== null ? ["--resume", session] : []),
                "--", prompt,
            ];
        case "codex":
            // The sandbox of Codex keeps a command off loopback without network access, `dashql` calls the app there
            return [
                "exec", "--json", "--skip-git-repo-check",
                "--sandbox", "workspace-write", "-c", "sandbox_workspace_write.network_access=true",
                ...(session !== null ? ["resume", session] : []),
                "--", prompt,
            ];
        case "opencode":
            // The opencode.json of the folder allows only `dashql`
            return ["run", "--format", "json", ...(session !== null ? ["--session", session] : []), "--", prompt];
    }
}

function isExecutable(file: string): boolean {
    try {
        if (!statSync(file).isFile()) return false;
        accessSync(file, constants.X_OK);
        return true;
    } catch {
        return false;
    }
}

/// The file that a program resolves to on a PATH, null if there is none
export function resolveProgram(program: string, searchPath: string): string | null {
    if (path.isAbsolute(program) || program.includes("/")) return isExecutable(program) ? program : null;
    for (const dir of searchPath.split(path.delimiter)) {
        if (dir.length === 0) continue;
        const file = path.join(dir, program);
        if (isExecutable(file)) return file;
    }
    return null;
}

/// Marks the PATH in the output of a login shell, an interactive shell may print a greeting
const PATH_MARKER = "__DASHQL_PATH__";
const LOGIN_SHELL_TIMEOUT_MS = 5000;

/// The PATH of the login shell of the user. An app started from the Finder or at login gets the minimal PATH of
/// launchd, without Homebrew, nvm or ~/.local/bin, where the harnesses are. Falls back to the PATH of the process.
export async function resolveLoginShellPath(env: NodeJS.ProcessEnv = process.env): Promise<string> {
    const fallback = env.PATH ?? "";
    const shell = env.SHELL;
    if (shell === undefined || shell.length === 0 || process.platform === "win32") return fallback;
    return await new Promise<string>((resolve) => {
        let stdout = "";
        let child: ChildProcess;
        try {
            child = spawn(shell, ["-ilc", `printf '${PATH_MARKER}%s${PATH_MARKER}' "$PATH"`], {env, stdio: ["ignore", "pipe", "ignore"]});
        } catch {
            resolve(fallback);
            return;
        }
        const timer = setTimeout(() => child.kill("SIGKILL"), LOGIN_SHELL_TIMEOUT_MS);
        child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
        child.on("error", () => { clearTimeout(timer); resolve(fallback); });
        child.on("close", (code) => {
            clearTimeout(timer);
            const found = stdout.split(PATH_MARKER)[1]?.trim() ?? "";
            resolve(code === 0 && found.length > 0 ? found : fallback);
        });
    });
}

/// The stderr of a harness is kept for its error, up to this many bytes
const STDERR_LIMIT = 16 * 1024;
/// How long a stopped harness may take before its process group is killed
export const KILL_GRACE_MS = 3000;
/// How long the output of a harness that exited may stay open
const OUTPUT_DRAIN_MS = 2000;

/// A run of a harness
export interface HarnessRun {
    /// Resolves once the process exited and its output is read
    readonly done: Promise<ReaderOutcome & {stopped: boolean}>;
    /// Stop the process and everything it started: SIGTERM to its process group, SIGKILL after KILL_GRACE_MS
    stop(): void;
}

/// What a run of a harness gets
export interface HarnessSpawn {
    harness: AgentHarness;
    /// The absolute path of the program
    program: string;
    args: string[];
    /// The folder of the workbook, the working folder of the run
    cwd: string;
    env: NodeJS.ProcessEnv;
    sink: ReaderSink;
    /// The grace before SIGKILL, for tests
    killGraceMs?: number;
}

function signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
    if (child.pid === undefined) return;
    try {
        // The negative pid is the process group of the harness, the commands of the agent included
        process.kill(-child.pid, signal);
    } catch {
        try { child.kill(signal); } catch { /* gone */ }
    }
}

/// Start a run of a harness in its own process group, with stdin closed
export function spawnHarness(options: HarnessSpawn): HarnessRun {
    const reader = createReader(options.harness, options.cwd);
    let stopped = false;
    let exited = false;
    let child: ChildProcess;
    try {
        child = spawn(options.program, options.args, {
            cwd: options.cwd,
            env: options.env,
            stdio: ["ignore", "pipe", "pipe"],
            detached: process.platform !== "win32",
            windowsHide: true,
        });
    } catch (error) {
        const message = `Cannot start ${options.program}: ${error instanceof Error ? error.message : String(error)}`;
        return {done: Promise.resolve({message: "", error: message, stopped: false}), stop: () => {}};
    }
    // Decoded by the streams, which keep a character that a chunk splits until its rest arrives
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    let stderr = "";
    child.stderr?.on("data", (chunk: string) => {
        stderr += chunk;
        if (stderr.length > STDERR_LIMIT) stderr = stderr.slice(-STDERR_LIMIT);
    });
    let pending = "";
    const readLine = (line: string) => {
        try {
            reader.line(line.replace(/\r$/, ""), options.sink);
        } catch (error) {
            console.error("Failed to read a line of a harness", error);
        }
    };
    child.stdout?.on("data", (chunk: string) => {
        pending += chunk;
        let end;
        while ((end = pending.indexOf("\n")) >= 0) {
            readLine(pending.slice(0, end));
            pending = pending.slice(end + 1);
        }
    });
    const done = new Promise<ReaderOutcome & {stopped: boolean}>((resolve) => {
        let spawnError: Error | null = null;
        child.on("error", (error) => { spawnError = error; });
        // A command that the agent left running in the background may hold the output open, the run ends anyway
        child.on("exit", () => {
            setTimeout(() => { child.stdout?.destroy(); child.stderr?.destroy(); }, OUTPUT_DRAIN_MS).unref();
        });
        child.on("close", (code) => {
            exited = true;
            clearTimeout(killTimer);
            if (pending.length > 0) readLine(pending);
            if (spawnError !== null) {
                resolve({message: "", error: `Cannot start ${options.program}: ${spawnError.message}`, stopped});
                return;
            }
            resolve({...reader.finish(code, stderr), stopped});
        });
    });
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    return {
        done,
        stop: () => {
            if (stopped || exited) return;
            stopped = true;
            signalGroup(child, "SIGTERM");
            killTimer = setTimeout(() => { if (!exited) signalGroup(child, "SIGKILL"); }, options.killGraceMs ?? KILL_GRACE_MS);
        },
    };
}
