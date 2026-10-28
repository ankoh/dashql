import {type ChildProcess, spawn} from "node:child_process";
import {readFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/// The ports of the agent server, see packages/dashql-cli/src/agent/config.rs
export const AGENT_PORT = 47100;
export const AGENT_DEV_PORT = 47101;

import type {AgentServerStatus, AgentStatusResponse} from "./agent_bridge.js";

export type {AgentServerStatus} from "./agent_bridge.js";

/// What the host knows about the agent server
export type AgentHostState =
    /// Not started, or stopped
    | "stopped"
    /// The child process runs but does not answer yet
    | "starting"
    /// The child process answers
    | "running"
    /// Another `dashql agent serve` with the same configuration holds the port, the host follows it
    | "external"
    /// The child process exited, the host starts it again after a delay
    | "failed";

export interface AgentHostSnapshot {
    state: AgentHostState;
    /// The last status of the server, null while it does not answer
    status: AgentServerStatus | null;
    /// Why the server is not running
    error: string | null;
}

export interface AgentHostOptions {
    /// The dashql binary
    binary: string;
    /// Accept the dev origins, use the dev port and ~/.dashql/agent-dev
    dev: boolean;
    /// The environment of the server, DASHQL_AGENT_HOME and DASHQL_AGENT_PORT are honored like the server does
    env?: NodeJS.ProcessEnv;
    /// How often the status is read
    pollIntervalMs?: number;
    /// The delays before the restarts after a crash, the last one repeats
    restartDelaysMs?: number[];
    /// A server that runs this long resets the restart delays
    stableAfterMs?: number;
    /// The lines that the server writes to stderr
    log?: (line: string) => void;
}

const DEFAULT_RESTART_DELAYS_MS = [1000, 2000, 5000, 10000, 30000];
/// The server gives a killed harness 3 s before it kills it for good, see KILL_GRACE in harness.rs
const STOP_GRACE_MS = 6000;
const STATUS_TIMEOUT_MS = 2000;

/// The folder of config.json, as `agent_home` in packages/dashql-cli/src/agent/config.rs
export function agentHome(env: NodeJS.ProcessEnv, dev: boolean): string {
    if (env.DASHQL_AGENT_HOME) return env.DASHQL_AGENT_HOME;
    return path.join(env.HOME ?? os.homedir(), ".dashql", dev ? "agent-dev" : "agent");
}

interface Endpoint {
    port: number;
    token: string;
}

/// The port and the token of the server from its config.json, null before the server created it
async function readEndpoint(env: NodeJS.ProcessEnv, dev: boolean): Promise<Endpoint | null> {
    let config: {port?: unknown; token?: unknown};
    try {
        config = JSON.parse(await readFile(path.join(agentHome(env, dev), "config.json"), "utf8"));
    } catch {
        return null;
    }
    if (typeof config.token !== "string" || config.token === "") return null;
    const fromEnv = Number(env.DASHQL_AGENT_PORT);
    const port = Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv
        : typeof config.port === "number" ? config.port
        : dev ? AGENT_DEV_PORT : AGENT_PORT;
    return {port, token: config.token};
}

type StatusResult = {ok: true; status: AgentServerStatus} | {ok: false; reachable: boolean};

/// GET /v1/status, reachable tells a server that refuses the token from no server at all
async function fetchStatus(endpoint: Endpoint): Promise<StatusResult> {
    try {
        const response = await fetch(`http://127.0.0.1:${endpoint.port}/v1/status`, {
            headers: {authorization: `Bearer ${endpoint.token}`},
            signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
        });
        const body = await response.json() as AgentStatusResponse;
        if (response.ok && body.ok) return {ok: true, status: body.status};
        return {ok: false, reachable: true};
    } catch {
        return {ok: false, reachable: false};
    }
}

/// Runs `dashql agent serve` as a child process: starts it again when it crashes, follows its status and stops it
/// on quit. When another server with the same configuration holds the port, the host follows that one instead.
export class AgentHost {
    readonly #options: AgentHostOptions;
    readonly #env: NodeJS.ProcessEnv;
    readonly #listeners = new Set<(snapshot: AgentHostSnapshot) => void>();
    #snapshot: AgentHostSnapshot = {state: "stopped", status: null, error: null};
    #child: ChildProcess | null = null;
    #childExited: Promise<void> | null = null;
    /// The last line on stderr, the error of a server that exits before it listens
    #lastLine = "";
    #listening = false;
    #restarts = 0;
    #startedAt = 0;
    #wanted = false;
    #restartTimer: NodeJS.Timeout | null = null;
    #pollTimer: NodeJS.Timeout | null = null;
    #polling = false;

    constructor(options: AgentHostOptions) {
        this.#options = options;
        this.#env = options.env ?? process.env;
    }

    get snapshot(): AgentHostSnapshot {
        return this.#snapshot;
    }

    /// The process id of the child process, null when the host runs none
    get pid(): number | null {
        return this.#child?.pid ?? null;
    }

    /// Listen to changes of the snapshot, returns the function that stops listening
    onChange(listener: (snapshot: AgentHostSnapshot) => void): () => void {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }

    /// Start the server, does nothing while it runs
    start(): void {
        if (this.#wanted) return;
        this.#wanted = true;
        this.#restarts = 0;
        this.#spawn();
        this.#schedulePoll(0);
    }

    /// Stop the server: SIGTERM stops its turns and closes its listener, SIGKILL after a grace period.
    /// The signal is sent before the first await, so callers on quit need not wait.
    async stop(): Promise<void> {
        this.#wanted = false;
        this.#clearTimers();
        const child = this.#child;
        const exited = this.#childExited;
        if (child !== null && exited !== null) {
            child.kill("SIGTERM");
            const timeout = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), STOP_GRACE_MS).unref());
            if (await Promise.race([exited, timeout]) === "timeout") {
                child.kill("SIGKILL");
                await exited;
            }
        }
        this.#publish({state: "stopped", status: null, error: null});
    }

    #spawn(): void {
        // The server stops when its stdin closes, so it does not outlive a crash of the app
        const args = ["agent", "serve", "--exit-with-stdin", ...(this.#options.dev ? ["--dev"] : [])];
        const child = spawn(this.#options.binary, args, {env: this.#env, stdio: ["pipe", "ignore", "pipe"]});
        child.stdin?.on("error", () => {});
        this.#child = child;
        this.#startedAt = Date.now();
        this.#lastLine = "";
        this.#listening = false;
        this.#publish({state: "starting", status: null, error: null});
        let buffered = "";
        child.stderr?.setEncoding("utf8");
        child.stderr?.on("data", (chunk: string) => {
            buffered += chunk;
            const lines = buffered.split("\n");
            buffered = lines.pop() ?? "";
            for (const line of lines.filter((l) => l.trim() !== "")) {
                this.#lastLine = line.replace(/^\[dashql\] /, "");
                if (this.#lastLine.startsWith("Listening on")) this.#listening = true;
                this.#options.log?.(line);
            }
        });
        this.#childExited = new Promise((resolve) => {
            child.once("error", (error) => {
                this.#lastLine = error.message;
            });
            child.once("close", (code, signal) => {
                if (this.#child === child) {
                    this.#child = null;
                    this.#childExited = null;
                }
                resolve();
                if (this.#wanted) void this.#exited(code, signal);
            });
        });
    }

    /// The child process exited while it should run
    async #exited(code: number | null, signal: NodeJS.Signals | null): Promise<void> {
        const exit = signal !== null ? `The agent server was killed with ${signal}` : `The agent server exited with code ${code}`;
        const error = !this.#listening && this.#lastLine !== "" ? this.#lastLine : exit;
        // Another server holds the port: follow it while it answers our token
        if (/is taken/.test(error)) {
            const endpoint = await readEndpoint(this.#env, this.#options.dev);
            const result = endpoint !== null ? await fetchStatus(endpoint) : null;
            if (!this.#wanted) return;
            if (result?.ok) {
                this.#publish({state: "external", status: result.status, error: null});
                return;
            }
        }
        if (Date.now() - this.#startedAt >= (this.#options.stableAfterMs ?? 60000)) this.#restarts = 0;
        const delays = this.#options.restartDelaysMs ?? DEFAULT_RESTART_DELAYS_MS;
        const delay = delays[Math.min(this.#restarts, delays.length - 1)] ?? 1000;
        this.#restarts += 1;
        this.#publish({state: "failed", status: null, error});
        this.#restartTimer = setTimeout(() => {
            this.#restartTimer = null;
            if (this.#wanted && this.#child === null) this.#spawn();
        }, delay);
    }

    #schedulePoll(delay: number): void {
        if (this.#pollTimer !== null) clearTimeout(this.#pollTimer);
        this.#pollTimer = setTimeout(() => void this.#poll(), delay);
    }

    async #poll(): Promise<void> {
        this.#pollTimer = null;
        if (!this.#wanted || this.#polling) return;
        this.#polling = true;
        try {
            const endpoint = await readEndpoint(this.#env, this.#options.dev);
            const result = endpoint !== null ? await fetchStatus(endpoint) : null;
            if (!this.#wanted) return;
            const {state} = this.#snapshot;
            if (result?.ok) {
                // A child that is about to exit may find another server on the port, #exited decides that
                if ((state === "starting" || state === "running") && this.#child !== null) {
                    this.#publish({state: "running", status: result.status, error: null});
                } else if (state === "external") {
                    this.#publish({state: "external", status: result.status, error: null});
                }
            } else if (state === "external") {
                // The other server went away, run our own
                this.#publish({state: "starting", status: null, error: null});
                if (this.#child === null) this.#spawn();
            } else if (state === "running") {
                this.#publish({state: "running", status: null, error: null});
            }
        } finally {
            this.#polling = false;
            if (this.#wanted) this.#schedulePoll(this.#options.pollIntervalMs ?? 2000);
        }
    }

    #clearTimers(): void {
        if (this.#restartTimer !== null) clearTimeout(this.#restartTimer);
        if (this.#pollTimer !== null) clearTimeout(this.#pollTimer);
        this.#restartTimer = null;
        this.#pollTimer = null;
    }

    #publish(next: AgentHostSnapshot): void {
        const previous = this.#snapshot;
        this.#snapshot = next;
        if (JSON.stringify(previous) === JSON.stringify(next)) return;
        for (const listener of this.#listeners) listener(next);
    }
}
