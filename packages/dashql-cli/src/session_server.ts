import http from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
    createAgentSessionState,
    reduceAgentSessionCopy,
    reduceAgentSessionEvent,
    type AgentSessionEvent,
    type AgentSessionState,
} from '@akohn/dashql/platform/session/agent_session_state';
import {
    AGENT_SESSION_RUN_HEADER,
    type AgentSessionChartSize,
    type AgentSessionRunMessage,
    type AgentSessionRunRequest,
} from '@akohn/dashql/platform/session/agent_session_client';
import { AGENT_SESSION_PROTOCOL, AGENT_SESSION_PROTOCOL_HEADER } from '@akohn/dashql/platform/session/agent_session_protocol';
import {
    DASHQL_FOLDER,
    isWorkbookCopyId,
    parseSessionConnections,
    SESSION_CONNECTIONS_FILE,
    type CopyFile,
} from '@akohn/dashql/platform/session/session_folder';
import { STORAGE_ATTACHMENTS_FOLDER, STORAGE_SCRIPTS_FOLDER, STORAGE_WORKBOOK_FILE } from '@akohn/dashql/platform/storage/storage_backend';

import { sessionCopiesFolder, sessionFolder as sessionFolderOf, SESSION_SERVER_FILE } from './session_folder.js';

/// How long a run waits for the first event of the tab
const RUN_CLAIM_TIMEOUT_MS = 30_000;

/// The size of the charts of a run request, null for a run without charts or a size out of bounds
function chartSize(value: unknown): AgentSessionChartSize | null {
    if (value == null || typeof value !== 'object') return null;
    const { width, height, scale } = value as Record<string, unknown>;
    const within = (n: unknown, max: number): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= max;
    return within(width, 4096) && within(height, 4096) && within(scale, 4) ? { width: Math.floor(width), height: Math.floor(height), scale } : null;
}

/// The pages that may follow a session: the web app, its dev server and the desktop app
export const SESSION_PAGE_ORIGINS = ['https://dashql.app', 'https://stable.dashql.app', 'https://dev.dashql.app', 'http://localhost:9002', 'http://127.0.0.1:9002', 'app://bundle'];

export interface SessionServerOptions {
    harness: string;
    folder: string;
    /// The port, 0 picks a free one
    port?: number;
    /// The token, a random one by default
    token?: string;
    /// The id of the session of `dashql connect`: the id of its state and its folder `.dashql/sessions/<id>/`, with the
    /// address of the server for the commands and the copies of the workbooks of the tab
    session: string;
}

/// A running server of a session
export interface SessionServer {
    port: number;
    token: string;
    /// The state as the events left it
    state: () => AgentSessionState;
    /// End the session unless the harness ended it, the pages learn it
    end: () => void;
    close: () => Promise<void>;
}

/// The folder of the query result cache in the root of the session (docs/design/storage_layout.md)
const RESULT_CACHE_FOLDER = 'cache';
/// The files of a workbook folder that the server hands out: what a published workbook holds (workbook_publishing.md)
const WORKBOOK_FILE = /^(dashql-workbook\.json|(scripts|attachments)\/[^/]+|connections\/[^/]+\/dashql-catalog-[a-z]+\.sql)$/;

/// A part of a path without its escapes, null for a malformed escape
function decodePart(part: string): string | null {
    try {
        return decodeURIComponent(part);
    } catch {
        return null;
    }
}

/// The token in the path of the routes of files, null for other routes
function pathToken(url: URL): string | null {
    const parts = url.pathname.split('/');
    const routes = ['workbooks', 'connections', 'runs', 'results'];
    return parts[1] === 'v1' && routes.includes(parts[2] ?? '') ? decodePart(parts[3] ?? '') : null;
}

/// A file of a workbook folder by its path in the folder, null unless the folder holds it and the server hands it out
function workbookFile(folder: string, parts: string[]): string | null {
    const relative = parts.join('/');
    if (!WORKBOOK_FILE.test(relative) || parts.some(part => part === '..' || part === '.')) return null;
    const file = path.resolve(folder, ...parts);
    if (!file.startsWith(folder + path.sep)) return null;
    try {
        return statSync(file).isFile() ? file : null;
    } catch {
        return null;
    }
}

/// The stamps of files of a workbook folder, files that are gone are left out
function stampFiles(folder: string, paths: string[]): CopyFile[] {
    return paths.flatMap(file => {
        const target = workbookFile(folder, file.split('/'));
        if (target == null) return [];
        const stats = statSync(target);
        return [{ path: file, size: stats.size, mtimeMs: stats.mtimeMs }];
    });
}

/// The paths of the files of a workbook folder that the server hands out: its workbook file, its scripts and its
/// attachments
function listWorkbookFiles(folder: string): string[] {
    const names = (sub: string) => {
        try {
            return readdirSync(path.join(folder, sub)).sort().map(name => `${sub}/${name}`);
        } catch {
            return [];
        }
    };
    const files = [...names(STORAGE_SCRIPTS_FOLDER), ...names(STORAGE_ATTACHMENTS_FOLDER)];
    return [STORAGE_WORKBOOK_FILE, ...files].filter(file => WORKBOOK_FILE.test(file) && workbookFile(folder, file.split('/')) != null);
}

function contentType(file: string): string {
    if (file.endsWith('.json')) return 'application/json';
    if (file.endsWith('.sql')) return 'text/plain; charset=utf-8';
    if (file.endsWith('.parquet')) return 'application/vnd.apache.parquet';
    return 'application/octet-stream';
}

function sendFile(response: http.ServerResponse, file: string, type: string): void {
    response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Length': statSync(file).size });
    createReadStream(file).pipe(response);
}

/// The body of a request
function readBody(request: http.IncomingMessage): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        request.on('data', chunk => chunks.push(chunk as Buffer));
        request.on('end', () => resolve(Buffer.concat(chunks)));
        request.on('error', reject);
    });
}

/// Write the body of a request to a file: next to its place and moved there, a reader never sees half of it
function writeAtomically(request: http.IncomingMessage, file: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const part = `${file}.${randomBytes(6).toString('hex')}.part`;
        const out = createWriteStream(part);
        const fail = (error: unknown) => {
            rmSync(part, { force: true });
            reject(error);
        };
        request.on('error', fail);
        out.on('error', fail);
        out.on('finish', () => {
            try {
                renameSync(part, file);
                resolve();
            } catch (error) {
                fail(error);
            }
        });
        request.pipe(out);
    });
}

/// Answer a request whose body could not be written
function failWrite(response: http.ServerResponse): void {
    if (!response.headersSent) response.writeHead(500);
    response.end();
}

/// Start the server of a session on 127.0.0.1. Hooks post the events of the harness to /v1/events, pages follow its
/// state on /v1/stream as server-sent events. Every request carries the token, pages in the query since an
/// EventSource sends no headers.
export async function startSessionServer(options: SessionServerOptions): Promise<SessionServer> {
    const token = options.token ?? randomBytes(24).toString('base64url');
    const origins = new Set(SESSION_PAGE_ORIGINS);
    let state = createAgentSessionState(options.harness, options.folder, options.session);
    const streams = new Set<http.ServerResponse>();

    const send = (response: http.ServerResponse) => response.write(`data: ${JSON.stringify(state)}\n\n`);
    const broadcast = () => { for (const stream of streams) send(stream); };
    // The folder of the session holds the address of the server and the copies, it goes when the session ends. The
    // folder of DashQL ignores itself, it is no part of a repository of the folder. The hooks find the server only
    // there, a folder that the server can't write to has no session.
    const dashqlFolder = path.join(options.folder, DASHQL_FOLDER);
    const sessionFolder = sessionFolderOf(options.folder, options.session);
    const copies = sessionCopiesFolder(options.folder, options.session);
    try {
        mkdirSync(sessionFolder, { recursive: true });
        writeFileSync(path.join(dashqlFolder, '.gitignore'), '*\n');
    } catch {
        throw new Error(`cannot write ${sessionFolder}`);
    }
    const removeSessionFolder = () => rmSync(sessionFolder, { force: true, recursive: true });

    /// Stamp the files of the copy of the workbook of a page once it has its workbook file, the caller broadcasts
    const stampCopy = (workbookId: string) => {
        const copy = path.join(copies, workbookId);
        if (!existsSync(path.join(copy, STORAGE_WORKBOOK_FILE))) return;
        state = reduceAgentSessionCopy(state, workbookId, stampFiles(copy, listWorkbookFiles(copy)));
    };
    /// Stamp the copies of the state again, the caller broadcasts
    const stampCopies = () => {
        for (const workbook of state.workbooks) stampCopy(workbook.workbookId);
    };
    const cors = (request: http.IncomingMessage, response: http.ServerResponse): boolean => {
        const origin = request.headers.origin;
        if (origin == null) return true;
        if (!origins.has(origin)) return false;
        response.setHeader('Access-Control-Allow-Origin', origin);
        response.setHeader('Vary', 'Origin');
        response.setHeader('Access-Control-Expose-Headers', AGENT_SESSION_PROTOCOL_HEADER);
        return true;
    };
    // The files of the workbooks and the results carry the token in their path, so the relative URLs of a workbook
    // folder (`scripts/a.sql` next to `dashql-workbook.json`) keep it
    const authorized = (request: http.IncomingMessage, url: URL) =>
        request.headers.authorization === `Bearer ${token}` || url.searchParams.get('token') === token
        || pathToken(url) === token;

    const sendJson = (response: http.ServerResponse, status: number, value: unknown) =>
        response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(value));

    /// POST /v1/events from the hooks: an event of the harness
    const postEvent = async (request: http.IncomingMessage, response: http.ServerResponse) => {
        let event: AgentSessionEvent;
        try {
            event = JSON.parse((await readBody(request)).toString('utf8')) as AgentSessionEvent;
        } catch {
            return void response.writeHead(400).end();
        }
        state = reduceAgentSessionEvent(state, event, Date.now());
        // The tools of the harness edit the files of a copy without a dashql command, the page sees their edits after
        // the tool
        if (event.event === 'PostToolUse' || event.event === 'Stop') stampCopies();
        broadcast();
        response.writeHead(204).end();
    };

    /// PUT /v1/connections/<token>: the connections that the tab lets the agent use, in the folder of the session, where
    /// the commands of the session read them
    const putConnections = async (request: http.IncomingMessage, response: http.ServerResponse) => {
        const connections = parseSessionConnections((await readBody(request)).toString('utf8'));
        if (connections == null) return void response.writeHead(400).end();
        try {
            writeFileSync(path.join(sessionFolder, SESSION_CONNECTIONS_FILE), `${JSON.stringify(connections, null, 2)}\n`);
        } catch {
            return void response.writeHead(500).end();
        }
        response.writeHead(204).end();
    };

    /// The runs that `dashql run` asked the tab for, by their id: the answer that streams their events
    const runs = new Map<string, { response: http.ServerResponse; claim: ReturnType<typeof setTimeout> | null }>();
    /// Tell the tabs about a run, after the state
    const sendRun = (message: AgentSessionRunMessage) => {
        for (const stream of streams) stream.write(`event: run\ndata: ${JSON.stringify(message)}\n\n`);
    };
    /// End the answer of a run, with a last event
    const endRun = (runId: string, last: unknown = null) => {
        const run = runs.get(runId);
        if (run == null) return;
        runs.delete(runId);
        if (run.claim != null) clearTimeout(run.claim);
        if (last != null) run.response.write(`${JSON.stringify(last)}\n`);
        run.response.end();
    };

    /// POST /v1/runs/<token> from `dashql run`: a run of the copy of a workbook of the tab. The tab runs it and posts
    /// its events, the answer streams them as JSON lines until run_finished.
    const startRun = async (request: http.IncomingMessage, response: http.ServerResponse) => {
        let run: AgentSessionRunRequest;
        try {
            const body = JSON.parse((await readBody(request)).toString('utf8')) as Partial<AgentSessionRunRequest>;
            if (typeof body.workbookId !== 'string' || !isWorkbookCopyId(body.workbookId)) throw new Error('no workbook');
            run = {
                workbookId: body.workbookId,
                label: typeof body.label === 'string' ? body.label : body.workbookId,
                scripts: Array.isArray(body.scripts) ? body.scripts.filter((script): script is string => typeof script === 'string') : [],
                refresh: body.refresh === true,
                rows: typeof body.rows === 'number' && body.rows >= 0 ? Math.floor(body.rows) : 10,
            };
            // A run of dashql vis asks the tab for its charts
            const chart = chartSize(body.chart);
            if (chart != null) run.chart = chart;
        } catch {
            return sendJson(response, 400, { error: 'the run names no workbook that a tab copied into the session' });
        }
        if (streams.size === 0) return sendJson(response, 409, { error: 'no tab of DashQL follows the session, open it with the line of dashql connect' });
        if (!state.workbooks.some(workbook => workbook.workbookId === run.workbookId)) {
            return sendJson(response, 409, { error: 'the tab of DashQL did not copy this workbook into the session' });
        }
        // The tab takes the files of the copy before it runs: the stamps go first on the same stream
        stampCopies();
        broadcast();
        const runId = randomBytes(8).toString('hex');
        response.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', [AGENT_SESSION_RUN_HEADER]: runId });
        response.flushHeaders();
        const claim = setTimeout(() => endRun(runId, { type: 'run_failed', error: 'no tab of DashQL took the run' }), RUN_CLAIM_TIMEOUT_MS);
        claim.unref();
        runs.set(runId, { response, claim });
        // A dashql run that goes away stops the run in the tab
        response.on('close', () => {
            if (!runs.has(runId)) return;
            endRun(runId);
            sendRun({ type: 'stop', runId });
        });
        sendRun({ type: 'run', runId, ...run });
    };

    /// POST /v1/runs/<token>/<run id> from the tab: an event of a run, the last one is run_finished
    const runEvent = async (request: http.IncomingMessage, response: http.ServerResponse, runId: string) => {
        const run = runs.get(runId);
        if (run == null) return void response.writeHead(404).end();
        let event: { type?: unknown };
        try {
            event = JSON.parse((await readBody(request)).toString('utf8')) as { type?: unknown };
            if (event == null || typeof event.type !== 'string') throw new Error('no event');
        } catch {
            return void response.writeHead(400).end();
        }
        if (run.claim != null) {
            clearTimeout(run.claim);
            run.claim = null;
        }
        if (event.type === 'run_finished') endRun(runId, event);
        else run.response.write(`${JSON.stringify(event)}\n`);
        response.writeHead(204).end();
    };

    const handle = (request: http.IncomingMessage, response: http.ServerResponse) => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1');
        // Every answer names the protocol of the server, a client tells by it which of the two is older
        response.setHeader(AGENT_SESSION_PROTOCOL_HEADER, String(AGENT_SESSION_PROTOCOL));
        if (!cors(request, response)) {
            response.writeHead(403).end();
            return;
        }
        if (request.method === 'OPTIONS') {
            response.writeHead(204, {
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
                'Access-Control-Allow-Headers': 'Authorization, Content-Type',
                // Chrome asks before a public page reaches the local network
                'Access-Control-Allow-Private-Network': 'true',
            }).end();
            return;
        }
        if (!authorized(request, url)) {
            response.writeHead(401).end();
            return;
        }
        if (request.method === 'POST' && url.pathname === '/v1/events') return void postEvent(request, response).catch(() => response.destroy());
        if (url.pathname.startsWith('/v1/runs/')) {
            // /v1/runs/<token> starts a run, /v1/runs/<token>/<run id> takes its events or stops it
            const parts = url.pathname.split('/');
            const runId = parts.length === 5 ? decodePart(parts[4]) : null;
            if (request.method === 'POST' && parts.length === 4) return void startRun(request, response).catch(() => response.destroy());
            if (runId == null) return void response.writeHead(404).end();
            if (request.method === 'POST') return void runEvent(request, response, runId).catch(() => response.destroy());
            if (request.method === 'DELETE') {
                if (!runs.has(runId)) return void response.writeHead(404).end();
                sendRun({ type: 'stop', runId });
                return void response.writeHead(204).end();
            }
            return void response.writeHead(404).end();
        }
        if (request.method === 'PUT' && url.pathname.split('/').length === 4 && url.pathname.startsWith('/v1/connections/')) {
            return void putConnections(request, response).catch(() => response.destroy());
        }
        if ((request.method === 'PUT' || request.method === 'DELETE') && url.pathname.startsWith('/v1/workbooks/')) {
            // The copy of the workbook of a page, /v1/workbooks/<token>/<workbook id>[/<path in the folder>]
            const decoded = url.pathname.split('/').slice(4).map(decodePart);
            const [workbookId, ...parts] = decoded;
            if (decoded.includes(null) || workbookId == null || !isWorkbookCopyId(workbookId) || (request.method === 'PUT' && parts.length === 0)) {
                response.writeHead(400).end();
                return;
            }
            const copy = path.join(copies, workbookId);
            if (parts.length === 0) {
                // The whole copy goes, the page writes it again
                rmSync(copy, { recursive: true, force: true });
                state = reduceAgentSessionCopy(state, workbookId, null);
                broadcast();
                response.writeHead(204).end();
                return;
            }
            const relative = (parts as string[]).join('/');
            if (!WORKBOOK_FILE.test(relative) || parts.some(part => part === '..' || part === '.')) {
                response.writeHead(400).end();
                return;
            }
            const file = path.join(copy, ...(parts as string[]));
            if (request.method === 'DELETE') {
                rmSync(file, { force: true });
                stampCopy(workbookId);
                broadcast();
                response.writeHead(204).end();
                return;
            }
            mkdirSync(path.dirname(file), { recursive: true });
            writeAtomically(request, file).then(() => {
                stampCopy(workbookId);
                broadcast();
                response.writeHead(204).end();
            }, () => failWrite(response)).catch(() => response.destroy());
            return;
        }
        if (request.method === 'PUT' && url.pathname.split('/').length === 5 && url.pathname.startsWith('/v1/results/')) {
            // /v1/results/<token>/<key>: the cached result of a run of the tab, into the query result cache of the
            // session as a new file of the key, where the agent reads it
            const key = url.pathname.split('/')[4];
            if (!/^[0-9a-f]{64}$/.test(key)) return void response.writeHead(400).end();
            const cache = path.join(dashqlFolder, RESULT_CACHE_FOLDER);
            const file = path.join(cache, `${key}.${randomUUID()}.parquet`);
            mkdirSync(cache, { recursive: true });
            writeAtomically(request, file).then(() => sendJson(response, 200, { file }), () => failWrite(response)).catch(() => response.destroy());
            return;
        }
        if (request.method === 'GET' && url.pathname.startsWith('/v1/workbooks/')) {
            // /v1/workbooks/<token>/<workbook id>/<path in the folder>
            const decoded = url.pathname.split('/').slice(4).map(decodePart);
            const [workbookId, ...parts] = decoded;
            const workbook = decoded.includes(null) ? null : state.workbooks.find(other => other.workbookId === workbookId);
            const file = workbook == null ? null : workbookFile(path.join(copies, workbook.workbookId), parts as string[]);
            if (file == null) {
                response.writeHead(404).end();
                return;
            }
            sendFile(response, file, contentType(file));
            return;
        }
        if (request.method === 'GET' && url.pathname === '/v1/state') {
            response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(state));
            return;
        }
        if (request.method === 'GET' && url.pathname === '/v1/stream') {
            response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
            send(response);
            streams.add(response);
            request.on('close', () => {
                streams.delete(response);
                // The runs of a tab that went away end, no other tab takes them
                if (streams.size > 0) return;
                for (const runId of [...runs.keys()]) endRun(runId, { type: 'run_failed', error: 'the tab of DashQL went away' });
            });
            return;
        }
        response.writeHead(404).end();
    };
    // A request never ends the server, whatever it sends
    const server = http.createServer((request, response) => {
        try {
            handle(request, response);
        } catch {
            if (!response.headersSent) response.writeHead(400);
            response.end();
        }
    });
    // Comments keep the streams open through proxies and tell a page that the server lives
    const keepAlive = setInterval(() => { for (const stream of streams) stream.write(': alive\n\n'); }, 15_000);
    keepAlive.unref();
    try {
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(options.port ?? 0, '127.0.0.1', () => resolve());
        });
    } catch (error) {
        // A port that is taken leaves no session folder behind
        clearInterval(keepAlive);
        removeSessionFolder();
        throw error;
    }
    const port = (server.address() as { port: number }).port;
    // The commands of the agent find the server in the folder of the session, readable by the user only
    writeFileSync(path.join(sessionFolder, SESSION_SERVER_FILE), `${JSON.stringify({ endpoint: `http://127.0.0.1:${port}`, token })}\n`, { mode: 0o600 });
    return {
        port,
        token,
        state: () => state,
        end: () => {
            if (state.ended) return;
            state = reduceAgentSessionEvent(state, { event: 'SessionEnd' }, Date.now());
            broadcast();
        },
        close: () => new Promise<void>(resolve => {
            clearInterval(keepAlive);
            // The commands of a later run find no session, the copies go with it
            removeSessionFolder();
            for (const runId of [...runs.keys()]) endRun(runId, { type: 'run_failed', error: 'the session ended' });
            for (const stream of streams) stream.end();
            server.close(() => resolve());
        }),
    };
}
