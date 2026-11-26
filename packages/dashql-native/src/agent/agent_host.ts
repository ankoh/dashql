// The agents of the app: a question on a workbook runs a harness of the machine headless in the folder of the
// workbook, the `dashql` commands of its agent call the page through the agent server, see
// docs/design/agent_integration.md. main.ts binds it to the windows, nothing here needs Electron.
import {execFile} from "node:child_process";
import {chmod, mkdir, readFile, rename, rm, writeFile} from "node:fs/promises";
import path from "node:path";

import {AgentServer, type AgentCallPart, type AgentCallRequest} from "./agent_server.js";
import {harnessArgs, harnessInfo, HARNESSES, INPUT_FOLDER, isHarness, resolveLoginShellPath, resolveProgram, spawnHarness, type HarnessRun} from "./harness.js";
import {isPlumbingStep, type AgentEvent, type AgentHarness} from "./readers.js";

/// A call of a `dashql` command as the page gets it
export interface AgentCall extends AgentCallRequest {
    callId: number;
}

/// The page that asked a question: it gets the events of the turn and answers the calls of its agent
export interface AgentPage {
    event(workbookId: string, event: AgentEvent): void;
    call(call: AgentCall): void;
    cancelCall(callId: number): void;
}

/// A question as the page asks it: the prompt that the harness gets
export interface AgentQuestion {
    workbookId: string;
    harness: AgentHarness;
    prompt: string;
}

export interface AgentHostOptions {
    /// The folder of the agents, `<userData>/agent`
    root: string;
    /// The `dashql` command that the agents call
    dashqlBinary: string;
    /// The environment of the harnesses, the environment of the app by default
    env?: NodeJS.ProcessEnv;
    /// The PATH that the harnesses are found on and that they get after the folder of `dashql`, the PATH of the login
    /// shell by default
    searchPath?: () => Promise<string>;
    /// The grace before a stopped harness is killed, for tests
    killGraceMs?: number;
}

/// The files that a page may write into the folder of a workbook
export type AgentFileKind = "chart" | "result";
const FILE_FOLDERS: Record<AgentFileKind, string> = {chart: "charts", result: "results"};

/// The ids of workbooks that name a folder, the ids of the app are UUIDs
const WORKBOOK_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
/// The names of the files that a page writes
const FILE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.@-]{0,254}$/;
/// The longest question
const MAX_PROMPT_BYTES = 1024 * 1024;
/// The ids of sessions of the harnesses that a state file may hold, a session becomes an argument
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/;
/// The largest conversation that the page keeps in the folder of a workbook
const MAX_CONVERSATION_BYTES = 4 * 1024 * 1024;
/// The file of the conversation as the page shows it, next to the sessions of the harnesses in state.json
const CONVERSATION_FILE = "conversation.json";

/// The state of the folder of a workbook: the session of every harness, which the next question resumes
interface WorkbookState {
    sessions: Partial<Record<AgentHarness, string>>;
}

interface Turn {
    workbookId: string;
    harness: AgentHarness;
    page: AgentPage;
    run: HarnessRun | null;
    stopped: boolean;
    /// Resolves once the turn ended
    ended: Promise<void>;
}

interface PendingCall {
    turn: Turn;
    write: (part: AgentCallPart) => void;
}

/// A text as a word of a POSIX shell
function shellWord(text: string): string {
    return `'${text.replaceAll("'", "'\\''")}'`;
}

/// What an agent is told in the folder of a workbook, before the guide of `dashql`
function instructions(harness: AgentHarness, guide: string): string {
    const input = harness === "claude"
        ? `Write the new text of a script with the Write tool to \`${INPUT_FOLDER}/<script>.sql\` and pass it with \`--file\`, e.g.
\`dashql edit orders --file ${INPUT_FOLDER}/orders.sql\`. You may write only into \`${INPUT_FOLDER}/\`, it is emptied for every
question. Take the current text of a script from \`dashql read\`.`
        : `Pass the new text of a script to \`dashql edit\` on stdin with a quoted heredoc, as a command of its own with
nothing after \`<<'EOF'\` on its line:

\`\`\`sh
dashql edit orders <<'EOF'
select count(*) from orders
EOF
\`\`\``;
    return `# DashQL workbook

You work on a workbook that is open in DashQL, the user asked the question in DashQL and watches the scripts change
and run. Work only through the \`dashql\` commands, this folder holds no project files.

${input}

${guide.trim()}
`;
}

/// opencode may only run `dashql`, the last matching rule wins
const OPENCODE_CONFIG = `{
    "$schema": "https://opencode.ai/config.json",
    "permission": {
        "edit": "deny",
        "webfetch": "deny",
        "bash": {
            "*": "deny",
            "dashql *": "allow"
        }
    }
}
`;

/// The agents of the app, see the module comment
export class AgentHost {
    readonly #options: AgentHostOptions;
    #server: Promise<AgentServer> | null = null;
    #searchPath: Promise<string> | null = null;
    #guide: Promise<string> | null = null;
    /// The turns that run, by workbook
    #turns = new Map<string, Turn>();
    #calls = new Map<number, PendingCall>();
    #nextCallId = 1;
    #closed = false;
    /// The writes of the conversations that run, by workbook, forget waits for them
    #conversationWrites = new Map<string, Promise<void>>();

    constructor(options: AgentHostOptions) {
        this.#options = options;
    }

    /// The folder of a workbook
    folderOf(workbookId: string): string {
        if (!WORKBOOK_ID.test(workbookId)) throw new Error("Rejected workbook id");
        return path.join(this.#options.root, "workbooks", workbookId);
    }

    /// The server of the calls, started with the first question
    server(): Promise<AgentServer> {
        if (this.#server === null) {
            this.#server = AgentServer.start({
                accepts: (workbookId) => this.#turns.has(workbookId),
                call: (request, write, signal) => this.#call(request, write, signal),
            });
            this.#server.catch(() => { this.#server = null; });
        }
        return this.#server;
    }

    #path(): Promise<string> {
        if (this.#searchPath === null) {
            this.#searchPath = this.#options.searchPath?.() ?? resolveLoginShellPath(this.#options.env ?? process.env);
        }
        return this.#searchPath;
    }

    /// The guide of `dashql`, which fits the commands of its build
    #readGuide(): Promise<string> {
        if (this.#guide === null) {
            this.#guide = new Promise<string>((resolve, reject) => {
                execFile(this.#options.dashqlBinary, ["guide"], {timeout: 10000, maxBuffer: 4 * 1024 * 1024}, (error, stdout) => {
                    if (error !== null) reject(new Error(`The dashql command of the app failed: ${error.message}`));
                    else resolve(stdout);
                });
            });
            this.#guide.catch(() => { this.#guide = null; });
        }
        return this.#guide;
    }

    /// The harnesses and whether the machine has them
    async info(): Promise<{harnesses: Array<{id: AgentHarness; available: boolean}>}> {
        const searchPath = await this.#path();
        return {harnesses: HARNESSES.map(({id, program}) => ({id, available: resolveProgram(program, searchPath) !== null}))};
    }

    /// Is a question running on the workbook?
    isRunning(workbookId: string): boolean {
        return this.#turns.has(workbookId);
    }

    /// Start a turn: resolves once the harness started, the page gets the events of the turn
    async ask(question: AgentQuestion, page: AgentPage): Promise<void> {
        if (this.#closed) throw new Error("DashQL is quitting");
        const {workbookId, harness, prompt} = question;
        if (typeof workbookId !== "string" || !WORKBOOK_ID.test(workbookId)) throw new Error("Rejected workbook id");
        if (!isHarness(harness)) throw new Error("Unknown harness");
        if (typeof prompt !== "string" || Buffer.byteLength(prompt) > MAX_PROMPT_BYTES) {
            throw new Error("Rejected question");
        }
        if (this.#turns.has(workbookId)) throw new Error("The agent still works on a question of this workbook");
        const info = harnessInfo(harness);
        // The turn holds the workbook while it starts, a second question waits for it
        let endTurn = () => {};
        const turn: Turn = {workbookId, harness, page, run: null, stopped: false, ended: new Promise<void>(resolve => { endTurn = resolve; })};
        this.#turns.set(workbookId, turn);
        let started = false;
        try {
            const searchPath = await this.#path();
            const program = resolveProgram(info.program, searchPath);
            if (program === null) throw new Error(`${info.program} is not installed: it is not on the PATH of your login shell`);
            const [server, guide] = await Promise.all([this.server(), this.#readGuide()]);
            const folder = this.folderOf(workbookId);
            await this.#prepareFolder(folder, workbookId, server, guide);
            const state = await this.#readState(folder);
            const session = state.sessions[harness] ?? null;
            if (turn.stopped) throw new Error("The question was stopped");
            // The page opened the turn when it asked, the events of the harness follow
            started = true;
            let newSession: string | null = null;
            const env = {...(this.#options.env ?? process.env), PATH: [path.join(folder, "bin"), searchPath].filter(part => part.length > 0).join(path.delimiter)};
            turn.run = spawnHarness({
                harness,
                program,
                args: harnessArgs(harness, {prompt, session, guide: instructions(harness, guide)}),
                cwd: folder,
                env,
                killGraceMs: this.#options.killGraceMs,
                sink: {
                    // The page tells the `dashql` commands itself, from their calls
                    tool: (event) => {
                        if (!isPlumbingStep(event.status)) page.event(workbookId, event);
                    },
                    say: (text) => page.event(workbookId, {event: "Say", text}),
                    session: (id) => {
                        if (!SESSION_ID.test(id) || id === newSession) return;
                        newSession = id;
                        // Kept at once, a stopped turn leaves a conversation as well
                        void this.#writeSession(folder, harness, id).catch(error => console.error("Failed to keep the session of the agent", error));
                    },
                },
            });
            void turn.run.done.then(async (outcome) => {
                // A session that could not be resumed is gone, the next question starts a new one
                if (outcome.error !== null && !outcome.stopped && session !== null && newSession === null) {
                    await this.#writeSession(folder, harness, null).catch(() => {});
                }
                this.#endTurn(turn, outcome.stopped || turn.stopped
                    ? {event: "Stop", message: outcome.message || null, error: null, interrupted: true}
                    : {event: "Stop", message: outcome.message || null, error: outcome.error});
                endTurn();
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (started) this.#endTurn(turn, {event: "Stop", message: null, error: message});
            else this.#endTurn(turn, null);
            endTurn();
            if (!started) throw new Error(message, {cause: error});
        }
    }

    #endTurn(turn: Turn, stop: AgentEvent | null): void {
        if (this.#turns.get(turn.workbookId) === turn) this.#turns.delete(turn.workbookId);
        for (const [callId, call] of this.#calls) {
            if (call.turn !== turn) continue;
            this.#calls.delete(callId);
            call.write({err: "error: the question ended\n", exit: 1});
            turn.page.cancelCall(callId);
        }
        if (stop !== null) turn.page.event(turn.workbookId, stop);
    }

    async #prepareFolder(folder: string, workbookId: string, server: AgentServer, guide: string): Promise<void> {
        await mkdir(folder, {recursive: true, mode: 0o700});
        await chmod(folder, 0o700);
        for (const dir of ["bin", "charts", "results"]) await mkdir(path.join(folder, dir), {recursive: true});
        // No file of an earlier question passes an older script text
        await rm(path.join(folder, INPUT_FOLDER), {recursive: true, force: true});
        await mkdir(path.join(folder, INPUT_FOLDER));
        const sessionFile = path.join(folder, "session.json");
        await writeFile(sessionFile, `${JSON.stringify({url: server.url, token: server.token, workbookId}, null, 4)}\n`, {mode: 0o600});
        await chmod(sessionFile, 0o600);
        // The session is an argument of every command, nothing comes from the environment
        const command = path.join(folder, "bin", "dashql");
        await writeFile(command, `#!/bin/sh\nexec ${shellWord(this.#options.dashqlBinary)} --session ${shellWord(sessionFile)} "$@"\n`, {mode: 0o755});
        await chmod(command, 0o755);
        await writeFile(path.join(folder, "AGENTS.md"), instructions("codex", guide));
        // Claude Code has the guide in its system prompt
        await writeFile(path.join(folder, "CLAUDE.md"), "The guide of DashQL is in your system prompt. Work only through the `dashql` commands.\n");
        await writeFile(path.join(folder, "opencode.json"), OPENCODE_CONFIG);
    }

    async #readState(folder: string): Promise<WorkbookState> {
        try {
            const value: unknown = JSON.parse(await readFile(path.join(folder, "state.json"), "utf8"));
            const sessions = (value as {sessions?: unknown} | null)?.sessions;
            const kept: WorkbookState = {sessions: {}};
            if (sessions !== null && typeof sessions === "object") {
                for (const [harness, id] of Object.entries(sessions)) {
                    if (isHarness(harness) && typeof id === "string" && SESSION_ID.test(id)) kept.sessions[harness] = id;
                }
            }
            return kept;
        } catch {
            return {sessions: {}};
        }
    }

    async #writeSession(folder: string, harness: AgentHarness, id: string | null): Promise<void> {
        const state = await this.#readState(folder);
        if (id === null) delete state.sessions[harness];
        else state.sessions[harness] = id;
        await writeFile(path.join(folder, "state.json"), `${JSON.stringify(state, null, 4)}\n`, {mode: 0o600});
    }

    /// Stop the turn of a workbook, resolves once it ended
    async stop(workbookId: string): Promise<void> {
        const turn = this.#turns.get(workbookId);
        if (turn === undefined) return;
        turn.stopped = true;
        turn.run?.stop();
        await turn.ended;
    }

    /// Stop the turn of a workbook and forget its conversations: the one that the page shows and the sessions of the
    /// harnesses, the next question starts a new conversation
    async forget(workbookId: string): Promise<void> {
        const folder = this.folderOf(workbookId);
        await this.stop(workbookId);
        await this.#conversationWrites.get(workbookId);
        await rm(folder, {recursive: true, force: true});
    }

    /// The conversation of a workbook as the page kept it, null without one. The page reads what it wrote.
    async readConversation(workbookId: string): Promise<unknown> {
        const file = path.join(this.folderOf(workbookId), CONVERSATION_FILE);
        try {
            return JSON.parse(await readFile(file, "utf8"));
        } catch {
            return null;
        }
    }

    /// Keep the conversation of a workbook as the page shows it, plain JSON that the page reads again
    async writeConversation(workbookId: string, conversation: unknown): Promise<void> {
        const folder = this.folderOf(workbookId);
        const text = JSON.stringify(conversation);
        if (typeof text !== "string" || conversation === null || typeof conversation !== "object" || Buffer.byteLength(text) > MAX_CONVERSATION_BYTES) {
            throw new Error("Rejected conversation");
        }
        const before = this.#conversationWrites.get(workbookId) ?? Promise.resolve();
        const write = before.then(async () => {
            await mkdir(folder, {recursive: true, mode: 0o700});
            const file = path.join(folder, CONVERSATION_FILE);
            const temporary = `${file}.tmp`;
            await writeFile(temporary, `${text}\n`, {mode: 0o600});
            await rename(temporary, file);
        });
        const settled = write.catch(() => {});
        this.#conversationWrites.set(workbookId, settled);
        void settled.then(() => {
            if (this.#conversationWrites.get(workbookId) === settled) this.#conversationWrites.delete(workbookId);
        });
        await write;
    }

    /// Stop the turns of a page that went away
    async detach(page: AgentPage): Promise<void> {
        await Promise.all([...this.#turns.values()].filter(turn => turn.page === page).map(turn => this.stop(turn.workbookId)));
    }

    /// An answer of the page to a call of its agent
    reply(page: AgentPage, reply: {callId: unknown; out?: unknown; err?: unknown; exit?: unknown}): void {
        if (typeof reply?.callId !== "number") return;
        const call = this.#calls.get(reply.callId);
        if (call === undefined || call.turn.page !== page) return;
        const exit = typeof reply.exit === "number" ? reply.exit : undefined;
        if (exit !== undefined) this.#calls.delete(reply.callId);
        call.write({
            ...(typeof reply.out === "string" ? {out: reply.out} : {}),
            ...(typeof reply.err === "string" ? {err: reply.err} : {}),
            ...(exit !== undefined ? {exit} : {}),
        });
    }

    /// Write a file of a call into the folder of a workbook whose question runs, returns its path in the folder
    async writeFile(page: AgentPage, file: {workbookId: unknown; kind: unknown; name: unknown; data: unknown}): Promise<string> {
        const {workbookId, kind, name, data} = file ?? {};
        if (typeof workbookId !== "string" || this.#turns.get(workbookId)?.page !== page) throw new Error("No question runs on this workbook");
        if (kind !== "chart" && kind !== "result") throw new Error("Rejected file kind");
        if (typeof name !== "string" || !FILE_NAME.test(name) || name.includes("..")) throw new Error("Rejected file name");
        if (!(data instanceof Uint8Array)) throw new Error("Rejected file data");
        const relative = `${FILE_FOLDERS[kind]}/${name}`;
        await writeFile(path.join(this.folderOf(workbookId), relative), data);
        return relative;
    }

    #call(request: AgentCallRequest, write: (part: AgentCallPart) => void, signal: AbortSignal): void {
        const turn = this.#turns.get(request.workbookId);
        if (turn === undefined) {
            write({err: "error: DashQL runs no question on this workbook\n", exit: 2});
            return;
        }
        const callId = this.#nextCallId++;
        this.#calls.set(callId, {turn, write});
        signal.addEventListener("abort", () => {
            if (this.#calls.delete(callId)) turn.page.cancelCall(callId);
        });
        turn.page.call({callId, ...request});
    }

    /// Stop every turn and the server, when the app quits
    async close(): Promise<void> {
        this.#closed = true;
        await Promise.all([...this.#turns.keys()].map(workbookId => this.stop(workbookId)));
        const server = this.#server;
        this.#server = null;
        if (server !== null) await (await server.catch(() => null))?.close();
    }
}
