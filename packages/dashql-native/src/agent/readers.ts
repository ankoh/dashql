// The readers of the output of a harness that the app runs headless: Claude Code (`-p --output-format stream-json`),
// Codex (`exec --json`) and opencode (`run --format json`), one JSON object per line. They tell the steps of a turn,
// the session of the harness to resume and the final message, see docs/design/agent_integration.md.

/// A harness that the app can run
export type AgentHarness = "claude" | "codex" | "opencode";

/// What a turn of a harness did, the shape of DashQLAgentEvent of packages/dashql-app/types/electron.d.ts
export type AgentEvent =
    | {event: "UserPromptSubmit"; prompt: string}
    | {event: "PreToolUse"; status: string; toolUseId: string | null}
    | {event: "PostToolUse"; status: string; toolUseId: string | null; error?: string | null}
    | {event: "Stop"; message?: string | null; error?: string | null; interrupted?: boolean};

/// A step of a tool, the readers tell its start and its end
export type ToolEvent = Extract<AgentEvent, {event: "PreToolUse" | "PostToolUse"}>;

/// What a reader tells while the harness runs
export interface ReaderSink {
    /// A tool started or ended
    tool(event: ToolEvent): void;
    /// The id of the session of the harness, to resume it with the next question
    session(id: string): void;
}

/// How a run ended: the final message of the agent, the error of a failed run
export interface ReaderOutcome {
    message: string;
    error: string | null;
}

/// Reads the output of a harness line by line
export interface HarnessReader {
    line(line: string, sink: ReaderSink): void;
    /// The outcome once the process exited, with its exit code (null if a signal ended it) and the end of its stderr
    finish(exitCode: number | null, stderr: string): ReaderOutcome;
}

/// The longest status line
const MAX_STATUS = 160;

/// The first line of a text, cut to the length of a status line
export function statusLine(text: string): string {
    const line = text.trim().split("\n")[0]?.trim() ?? "";
    return line.length > MAX_STATUS ? `${line.slice(0, MAX_STATUS - 1)}…` : line;
}

type Json = Record<string, unknown>;

function parseObject(line: string): Json | null {
    try {
        const value: unknown = JSON.parse(line);
        return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : null;
    } catch {
        return null;
    }
}

function field(value: unknown, ...keys: string[]): unknown {
    let current = value;
    for (const key of keys) {
        if (current === null || typeof current !== "object") return undefined;
        current = (current as Json)[key];
    }
    return current;
}

function text(value: unknown, ...keys: string[]): string | null {
    const found = field(value, ...keys);
    return typeof found === "string" ? found : null;
}

/// The message of an error that a harness reports. Codex passes the JSON body of a failed API call as the message.
export function errorMessage(message: string): string {
    const body = parseObject(message);
    return text(body, "error", "message") ?? text(body, "message") ?? message;
}

function exitError(exitCode: number | null, stderr: string): string {
    const detail = statusLine(stderr);
    const status = exitCode === null ? "was killed" : `exited with code ${exitCode}`;
    return detail.length === 0 ? `The harness ${status}` : `The harness ${status}: ${detail}`;
}

/// The outcome of a run that reported its own error, or that exited
function outcome(message: string, error: string | null, exitCode: number | null, stderr: string): ReaderOutcome {
    if (error !== null) return {message, error};
    return {message, error: exitCode === 0 ? null : exitError(exitCode, stderr)};
}

/// The command of a shell that Codex wraps it into, `bash -lc '<command>'`
function unwrapShell(command: string): string {
    const match = /^(?:\/(?:usr\/)?bin\/)?(?:ba|z)?sh\s+-l?c\s+(['"])([\s\S]*)\1\s*$/.exec(command.trim());
    if (match === null) return command;
    return match[1] === "'" ? match[2].replaceAll("'\\''", "'") : match[2].replace(/\\(["\\$`])/g, "$1");
}

/// The files of a patch of Codex, `*** Update File: <path>`
function patchFilesOf(patch: string): string[] {
    return [...patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map(match => match[1].trim());
}

/// The paths in a text as the page shows them: relative to the folder of the workbook, where the harness runs
function shortPaths(line: string, folder: string): string {
    if (folder.length <= 1) return line;
    const prefix = folder.endsWith("/") ? folder : `${folder}/`;
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // `cd <folder> && ` in front of a command says nothing
    return line.replace(new RegExp(`^cd\\s+(["']?)${escaped.slice(0, -1)}/?\\1\\s*&&\\s*`), "").split(prefix).join("");
}

/// What a tool does, in one line: the command of a shell, else the tool with its file, pattern, query, URL or
/// description, else the tool
export function toolStatus(tool: string, input: unknown, folder: string): string {
    const command = text(input, "command") ?? text(input, "cmd") ?? (typeof input === "string" ? input : null);
    if (command !== null && command.trimStart().startsWith("*** Begin Patch")) {
        return statusLine(shortPaths(`${tool} ${patchFilesOf(command).join(", ")}`, folder));
    }
    if (command !== null) return statusLine(shortPaths(unwrapShell(command), folder));
    const file = text(input, "file_path") ?? text(input, "filePath") ?? text(input, "notebook_path");
    if (file !== null) return statusLine(`${tool} ${shortPaths(file, folder)}`);
    const subject = text(input, "pattern") ?? text(input, "query") ?? text(input, "url") ?? text(input, "description") ?? text(input, "path");
    if (subject !== null) return statusLine(`${tool} ${shortPaths(subject, folder)}`);
    return statusLine(tool);
}

/// The text of the content of a tool result of Claude Code, a string or text blocks
function resultText(content: unknown): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) return content.map(block => text(block, "text") ?? "").join("");
    return "";
}

/// Reads `claude -p --output-format stream-json --verbose`: system init, assistant messages with tool uses, user
/// messages with tool results, the result
export class ClaudeReader implements HarnessReader {
    #message = "";
    #error: string | null = null;
    /// The subtype of a failed result without a text, the error comes from stderr then
    #failed: string | null = null;
    /// The status lines of the tools that run, by the id of their use
    #open = new Map<string, string>();

    constructor(readonly folder: string) {}

    line(line: string, sink: ReaderSink): void {
        const event = parseObject(line);
        if (event === null) return;
        switch (event.type) {
            case "system": {
                // Hooks carry a session id before the conversation exists, only init names the conversation
                const id = text(event, "session_id");
                if (event.subtype === "init" && id !== null) sink.session(id);
                break;
            }
            case "assistant":
                for (const block of asArray(field(event, "message", "content"))) {
                    if (text(block, "type") !== "tool_use") continue;
                    const id = text(block, "id");
                    const status = toolStatus(text(block, "name") ?? "tool", field(block, "input"), this.folder);
                    if (id !== null) this.#open.set(id, status);
                    sink.tool({event: "PreToolUse", status, toolUseId: id});
                }
                break;
            case "user":
                for (const block of asArray(field(event, "message", "content"))) {
                    if (text(block, "type") !== "tool_result") continue;
                    const id = text(block, "tool_use_id");
                    const status = (id !== null ? this.#open.get(id) : undefined) ?? "tool";
                    if (id !== null) this.#open.delete(id);
                    const failed = field(block, "is_error") === true;
                    sink.tool({event: "PostToolUse", status, toolUseId: id, ...(failed ? {error: statusLine(resultText(field(block, "content"))) || "failed"} : {})});
                }
                break;
            case "result": {
                const result = text(event, "result");
                if (result !== null) this.#message = result;
                const subtype = field(event, "subtype");
                if (event.is_error === true || (subtype != null && subtype !== "success")) {
                    if (result !== null && result.length > 0) this.#error = result;
                    else this.#failed = typeof subtype === "string" ? subtype : "an error";
                }
                break;
            }
        }
    }

    finish(exitCode: number | null, stderr: string): ReaderOutcome {
        // E.g. "No conversation found with session ID: ..." on stderr for error_during_execution
        let error = this.#error;
        if (error === null && this.#failed !== null) {
            const detail = statusLine(stderr);
            error = detail.length > 0 ? detail : `The run ended with ${this.#failed}`;
        }
        return outcome(this.#message, error, exitCode, stderr);
    }
}

function asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

/// Reads `codex exec --json`: thread.started, item.started and item.completed, turn.completed, turn.failed, error
export class CodexReader implements HarnessReader {
    #message = "";
    #error: string | null = null;
    /// The items that started, by their id, with their status lines
    #open = new Map<string, string>();

    constructor(readonly folder: string) {}

    /// The status line of an item that is a step, null for the other items
    #stepOf(item: unknown): string | null {
        switch (text(item, "type")) {
            case "command_execution": return toolStatus("shell", text(item, "command") ?? "", this.folder);
            case "file_change": {
                const paths = asArray(field(item, "changes")).map(change => text(change, "path")).filter((path): path is string => path !== null);
                return statusLine(`Edit ${paths.map(path => shortPaths(path, this.folder)).join(", ")}`);
            }
            case "mcp_tool_call": return statusLine(`${text(item, "server") ?? "mcp"}.${text(item, "tool") ?? "tool"}`);
            case "web_search": return toolStatus("search", {query: text(item, "query") ?? ""}, this.folder);
            default: return null;
        }
    }

    line(line: string, sink: ReaderSink): void {
        const event = parseObject(line);
        if (event === null) return;
        switch (event.type) {
            case "thread.started": {
                const id = text(event, "thread_id");
                if (id !== null) sink.session(id);
                break;
            }
            case "item.started": {
                const item = event.item;
                const status = this.#stepOf(item);
                if (status === null) break;
                const id = text(item, "id");
                if (id !== null) this.#open.set(id, status);
                sink.tool({event: "PreToolUse", status, toolUseId: id});
                break;
            }
            case "item.completed": {
                const item = event.item;
                if (text(item, "type") === "agent_message") {
                    this.#message = text(item, "text") ?? this.#message;
                    break;
                }
                const status = this.#stepOf(item);
                if (status === null) break;
                const id = text(item, "id");
                // A step that completes without its start, e.g. a change of files, starts and ends at once
                if (id === null || !this.#open.has(id)) sink.tool({event: "PreToolUse", status, toolUseId: id});
                if (id !== null) this.#open.delete(id);
                const exitCode = field(item, "exit_code");
                const failed = text(item, "status") === "failed" || text(item, "status") === "declined" || (typeof exitCode === "number" && exitCode !== 0);
                const error = failed ? (typeof exitCode === "number" ? `exit code ${exitCode}` : text(item, "status") ?? "failed") : null;
                sink.tool({event: "PostToolUse", status, toolUseId: id, ...(error !== null ? {error} : {})});
                break;
            }
            case "turn.completed":
                // Codex reports errors that it recovered from, e.g. a stream that it reconnected
                this.#error = null;
                break;
            case "turn.failed":
                this.#error = errorMessage(text(event, "error", "message") ?? "The turn failed");
                break;
            case "error":
                this.#error = errorMessage(text(event, "message") ?? "The harness failed");
                break;
        }
    }

    finish(exitCode: number | null, stderr: string): ReaderOutcome {
        return outcome(this.#message, this.#error, exitCode, stderr);
    }
}

/// Reads `opencode run --format json`: step_start, text, tool_use, step_finish, error. Every event carries the
/// sessionID. The final message is the text of the last step without tool calls: a step may report its text after its
/// tool calls. A tool use comes once it ended.
export class OpencodeReader implements HarnessReader {
    #texts: string[] = [];
    /// Did the current step call a tool?
    #stepUsedTools = false;
    #error: string | null = null;
    #session: string | null = null;

    constructor(readonly folder: string) {}

    line(line: string, sink: ReaderSink): void {
        const event = parseObject(line);
        if (event === null) return;
        const session = text(event, "sessionID") ?? text(event, "part", "sessionID");
        if (session !== null && session !== this.#session) {
            this.#session = session;
            sink.session(session);
        }
        switch (event.type) {
            case "step_start":
                this.#texts = [];
                this.#stepUsedTools = false;
                break;
            case "step_finish":
                if (this.#stepUsedTools || text(event, "part", "reason") === "tool-calls") this.#texts = [];
                this.#stepUsedTools = false;
                break;
            case "text": {
                const value = text(event, "part", "text");
                if (value !== null && value.trim().length > 0) this.#texts.push(value);
                break;
            }
            case "tool_use": {
                this.#texts = [];
                this.#stepUsedTools = true;
                const status = toolStatus(text(event, "part", "tool") ?? "tool", field(event, "part", "state", "input"), this.folder);
                const id = text(event, "part", "callID") ?? text(event, "part", "id");
                const failed = text(event, "part", "state", "status") === "error";
                sink.tool({event: "PreToolUse", status, toolUseId: id});
                sink.tool({event: "PostToolUse", status, toolUseId: id, ...(failed ? {error: statusLine(text(event, "part", "state", "error") ?? "failed")} : {})});
                break;
            }
            case "error": {
                const found = [["message"], ["error", "data", "message"], ["error", "message"], ["error", "name"]]
                    .map(path => field(event, ...path)).find(value => value != null);
                this.#error = typeof found === "string" ? found : found !== undefined ? JSON.stringify(found) : "The harness failed";
                break;
            }
        }
    }

    finish(exitCode: number | null, stderr: string): ReaderOutcome {
        return outcome(this.#texts.join("\n").trim(), this.#error, exitCode, stderr);
    }
}

/// The reader of a harness, `folder` is where it runs: paths in status lines are relative to it
export function createReader(harness: AgentHarness, folder: string): HarnessReader {
    switch (harness) {
        case "claude": return new ClaudeReader(folder);
        case "codex": return new CodexReader(folder);
        case "opencode": return new OpencodeReader(folder);
    }
}
