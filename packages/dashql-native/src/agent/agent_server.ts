// The server of the `dashql` commands of the agents: the commands that an agent runs post their calls to it, and the
// app answers them with the workbook that the question runs on, see docs/design/agent_integration.md. It listens on
// loopback with a token of its own per start of the app. Nothing here needs Electron.
import {randomBytes, timingSafeEqual} from "node:crypto";
import {createServer, type IncomingMessage, type Server, type ServerResponse} from "node:http";

/// A call of a `dashql` command
export interface AgentCallRequest {
    workbookId: string;
    command: string;
    args: Record<string, unknown>;
    input: string | null;
}

/// A part of the answer of a call: text for stdout or stderr, the exit code ends the call
export interface AgentCallPart {
    out?: string;
    err?: string;
    exit?: number;
}

/// Who answers the calls
export interface AgentCallHandler {
    /// Does a question run on the workbook? Only then its agent calls.
    accepts(workbookId: string): boolean;
    /// Answer a call: write its parts, the one with `exit` ends it. The signal aborts when the command went away.
    call(request: AgentCallRequest, write: (part: AgentCallPart) => void, signal: AbortSignal): void;
}

/// The largest request, the text of a script that `edit` passes included
export const MAX_CALL_BYTES = 16 * 1024 * 1024;

/// The server, see AgentServer.start
export class AgentServer {
    readonly url: string;
    readonly token: string;
    #server: Server;
    /// The workbooks with a call that runs, one call at a time per workbook
    #busy = new Set<string>();

    private constructor(server: Server, url: string, token: string) {
        this.#server = server;
        this.url = url;
        this.token = token;
    }

    /// Listen on a random port of 127.0.0.1 with a new token
    static async start(handler: AgentCallHandler): Promise<AgentServer> {
        const token = randomBytes(32).toString("hex");
        let instance: AgentServer | null = null;
        const server = createServer((request, response) => {
            if (instance !== null) instance.#handle(handler, request, response);
        });
        await new Promise<void>((resolve, reject) => {
            server.once("error", reject);
            server.listen(0, "127.0.0.1", () => resolve());
        });
        const address = server.address();
        if (address === null || typeof address === "string") throw new Error("The agent server did not bind a port");
        instance = new AgentServer(server, `http://127.0.0.1:${address.port}`, token);
        return instance;
    }

    async close(): Promise<void> {
        this.#server.closeAllConnections();
        await new Promise<void>((resolve) => this.#server.close(() => resolve()));
    }

    #authorized(request: IncomingMessage): boolean {
        const header = request.headers.authorization ?? "";
        const expected = Buffer.from(`Bearer ${this.token}`);
        const actual = Buffer.from(header);
        return actual.length === expected.length && timingSafeEqual(actual, expected);
    }

    #handle(handler: AgentCallHandler, request: IncomingMessage, response: ServerResponse): void {
        const fail = (status: number, message: string) => {
            if (response.headersSent) return;
            response.writeHead(status, {"content-type": "text/plain; charset=utf-8", "connection": "close"});
            response.end(message);
            request.resume();
        };
        const pathname = (request.url ?? "").split("?")[0];
        if (request.method !== "POST" || pathname !== "/v1/call") return fail(404, "Not found");
        if (!this.#authorized(request)) return fail(401, "The token of the session is wrong, the app was restarted: ask the question again");
        const length = Number(request.headers["content-length"] ?? "0");
        if (length > MAX_CALL_BYTES) return fail(413, "The call is too large");
        const chunks: Buffer[] = [];
        let size = 0;
        let tooLarge = false;
        request.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_CALL_BYTES) tooLarge = true;
            else chunks.push(chunk);
        });
        request.on("end", () => {
            if (tooLarge) return fail(413, "The call is too large");
            const call = parseCall(Buffer.concat(chunks).toString("utf8"));
            if (typeof call === "string") return fail(400, call);
            if (!handler.accepts(call.workbookId)) return fail(409, "DashQL runs no question on this workbook");
            if (this.#busy.has(call.workbookId)) return fail(409, "Another dashql command of this workbook still runs, run one at a time");
            this.#busy.add(call.workbookId);
            response.writeHead(200, {"content-type": "application/x-ndjson", "cache-control": "no-cache"});
            response.flushHeaders();
            const abort = new AbortController();
            let ended = false;
            const end = () => {
                if (ended) return;
                ended = true;
                this.#busy.delete(call.workbookId);
            };
            // The command went away, e.g. on Ctrl-C, before its call ended
            response.on("close", () => {
                if (!ended) {
                    end();
                    abort.abort();
                }
            });
            const write = (part: AgentCallPart) => {
                if (ended) return;
                const line: AgentCallPart = {};
                if (typeof part.out === "string" && part.out.length > 0) line.out = part.out;
                if (typeof part.err === "string" && part.err.length > 0) line.err = part.err;
                if (line.out !== undefined || line.err !== undefined) response.write(`${JSON.stringify(line)}\n`);
                if (part.exit !== undefined) {
                    const exit = Number.isInteger(part.exit) && part.exit >= 0 && part.exit <= 255 ? part.exit : 1;
                    end();
                    response.end(`${JSON.stringify({exit})}\n`);
                }
            };
            try {
                handler.call(call, write, abort.signal);
            } catch (error) {
                write({err: `error: ${error instanceof Error ? error.message : String(error)}\n`, exit: 1});
            }
        });
    }
}

/// The call of a request body, or the error of a malformed one
export function parseCall(body: string): AgentCallRequest | string {
    let value: unknown;
    try {
        value = JSON.parse(body);
    } catch {
        return "The call is no JSON";
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) return "The call is no JSON object";
    const {workbookId, command, args, input} = value as Record<string, unknown>;
    if (typeof workbookId !== "string" || workbookId.length === 0) return "The call names no workbook";
    if (typeof command !== "string" || !/^[a-z][a-z-]*$/.test(command)) return "The call names no command";
    if (args !== undefined && (args === null || typeof args !== "object" || Array.isArray(args))) return "The arguments of the call are no object";
    if (input !== undefined && input !== null && typeof input !== "string") return "The input of the call is no text";
    return {workbookId, command, args: (args ?? {}) as Record<string, unknown>, input: input ?? null};
}
