import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';

import { LogLevel, type LogRecord } from '@ankoh/dashql/platform/logger/log_buffer';
import {
    createAgentSessionState,
    parseAgentSessionOAuth,
    reduceAgentSessionEvent,
    reduceAgentSessionJournal,
    type AgentSessionEvent,
    type AgentSessionLoginAnswer,
    type AgentSessionState,
} from '@ankoh/dashql/platform/session/agent_session_state';
import {
    AGENT_SESSION_MIN_PROTOCOL,
    AGENT_SESSION_MIN_PROTOCOL_HEADER,
    AGENT_SESSION_PROTOCOL,
    AGENT_SESSION_PROTOCOL_HEADER,
    parseAgentSessionProtocol,
    serverAcceptsAgentSessionClient,
} from '@ankoh/dashql/platform/session/agent_session_protocol';
import {
    isWorkbookCopyId,
    parseSessionConnections,
    SESSION_CONNECTIONS_FILE,
    JOURNAL_KEYS,
    JOURNAL_TARGET,
    journalFilePaths,
    journalFilesMarker,
    parseJournalLines,
    sessionJournalPath,
    SESSION_JOURNAL_FOLDER,
    workbookCopyPath,
    type JournalFile,
} from '@ankoh/dashql/platform/session/workbook_journal';
import { loginKind, type ConnectAuth, type LoginConnection } from './connect_auth.js';
import { STORAGE_ATTACHMENTS_FOLDER, STORAGE_SCRIPTS_FOLDER, STORAGE_WORKBOOK_FILE } from '@ankoh/dashql/platform/storage/storage_backend';

/// How long a request for a login waits before it answers that the login still waits
export const LOGIN_POLL_MS = 20_000;
/// The headers of a request of a run that the relay doesn't forward: the connection, its own token and its address
const RELAY_DROPPED_HEADERS = new Set(['host', 'authorization', 'x-dashql-url', 'x-dashql-protocol', 'connection', 'content-length', 'origin', 'transfer-encoding', 'keep-alive']);

/// The headers of an answer of an endpoint that the relay doesn't hand back: the encoding and the length of the body,
/// which fetch decoded, the connection and the cookies of the endpoint, and the protocol, which the server names
const RELAY_DROPPED_RESPONSE_HEADERS = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive', 'set-cookie', 'x-dashql-protocol', 'x-dashql-min-protocol']);

/// The headers of an answer that a page reads
const EXPOSED_HEADERS = `${AGENT_SESSION_PROTOCOL_HEADER}, ${AGENT_SESSION_MIN_PROTOCOL_HEADER}, X-DashQL-Cached-At`;

/// The pages that may follow a session: the web app, its dev server and the desktop app
export const SESSION_PAGE_ORIGINS = ['https://dashql.app', 'https://stable.dashql.app', 'https://dev.dashql.app', 'http://localhost:9002', 'http://127.0.0.1:9002', 'app://bundle'];

export interface SessionServerOptions {
    harness: string;
    folder: string;
    /// The folder of the files of DashQL whose query result cache serves the results of the journal, the `.dashql/` of the
    /// folder by default: commands below the folder keep their files there
    home?: string | null;
    /// The port, 0 picks a free one
    port?: number;
    /// The token, a random one by default
    token?: string;
    /// The name of the session of `dashql connect`, its journal is `.dashql/sessions/<name>/journal.jsonl`; without
    /// one the journal is `.dashql/journal.jsonl`
    session?: string | null;
    /// The pages that may follow the session, besides requests without an origin
    origins?: string[];
    /// Called when the harness ended the session
    onEnd?: () => void;
    /// The logins of the connections of the session, the runs of the agent reach them through the relay
    auth?: ConnectAuth | null;
    /// How the relay sends the requests of the runs, fetch by default
    fetch?: typeof fetch;
}

/// A running server of a session
export interface SessionServer {
    port: number;
    token: string;
    /// The state as the events left it
    state: () => AgentSessionState;
    close: () => Promise<void>;
}

/// How often the server looks for lines that were appended to the journal
const JOURNAL_READ_INTERVAL_MS = 200;
/// The folder of the query result cache in the folder of the files of DashQL (docs/design/storage_layout.md)
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
    const routes = ['workbooks', 'results', 'connections', 'auth', 'login', 'relay'];
    return parts[1] === 'v1' && routes.includes(parts[2] ?? '') ? decodePart(parts[3] ?? '') : null;
}

/// A workbook folder of the journal, only inside the folder of the session: the server hands out no other files
function workbookFolder(sessionFolder: string, relative: string): string {
    const folder = path.resolve(sessionFolder, relative);
    const root = path.resolve(sessionFolder);
    return folder === root || folder.startsWith(root + path.sep) ? folder : path.join(root, '\0outside');
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
function stampFiles(folder: string, paths: string[]): JournalFile[] {
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

/// The newest file of a key in the query result cache, `<key>.<uuid>.parquet`
function newestResultFile(cache: string, key: string): { path: string; mtimeMs: number } | null {
    if (!/^[0-9a-f]{64}$/.test(key)) return null;
    let newest: { path: string; mtimeMs: number } | null = null;
    try {
        for (const name of readdirSync(cache)) {
            if (!name.startsWith(`${key}.`) || !name.endsWith('.parquet')) continue;
            const stats = statSync(path.join(cache, name));
            // An empty file is still being written
            if (stats.size === 0) continue;
            if (newest == null || stats.mtimeMs > newest.mtimeMs) newest = { path: path.join(cache, name), mtimeMs: stats.mtimeMs };
        }
    } catch {
        return null;
    }
    return newest;
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

/// Start the server of a session on 127.0.0.1. Hooks post the events of the harness to /v1/events, pages follow its
/// state on /v1/stream as server-sent events. Every request carries the token, pages in the query since an
/// EventSource sends no headers.
export async function startSessionServer(options: SessionServerOptions): Promise<SessionServer> {
    const token = options.token ?? randomBytes(24).toString('base64url');
    const origins = new Set(options.origins ?? SESSION_PAGE_ORIGINS);
    let state = createAgentSessionState(options.harness, options.folder);
    const streams = new Set<http.ServerResponse>();

    const send = (response: http.ServerResponse) => response.write(`data: ${JSON.stringify(state)}\n\n`);
    const broadcast = () => { for (const stream of streams) send(stream); };
    /// The copy of the workbook of a page changed: once it has its workbook file, the state names its files like the
    /// files of a workbook folder of the journal
    const stampCopy = (workbookId: string) => {
        const relative = workbookCopyPath(workbookId);
        const copy = path.join(options.folder, ...relative.split('/'));
        const paths = listWorkbookFiles(copy);
        const { message, keyValues } = journalFilesMarker({ workbook: relative, workbookId }, paths);
        const marker: LogRecord = { timestamp: Date.now(), level: LogLevel.Info, target: JOURNAL_TARGET, message, context: null, tracing: null, keyValues };
        state = reduceAgentSessionJournal(state, marker, stampFiles(copy, paths));
    };
    const announceCopy = (workbookId: string, copy: string) => {
        if (!existsSync(path.join(copy, STORAGE_WORKBOOK_FILE))) return;
        stampCopy(workbookId);
        broadcast();
    };
    /// Stamp the copies of the state again, the caller broadcasts
    const announceCopies = () => {
        for (const workbook of state.workbooks) {
            if (workbook.path === workbookCopyPath(workbook.workbookId)) stampCopy(workbook.workbookId);
        }
    };

    // The journal of the session starts empty, dashql commands below the folder append to it. The folder ignores
    // itself, it is no part of a repository of the folder.
    // A folder that the server can't write to has no journal, the page still follows the conversation.
    const journalFolder = path.join(options.folder, SESSION_JOURNAL_FOLDER);
    let journal: string | null = path.join(journalFolder, ...sessionJournalPath(options.session ?? null));
    // A session of `dashql connect` removes its folder when it stops
    const sessionFolder = options.session != null ? path.dirname(journal) : null;
    try {
        mkdirSync(path.dirname(journal), { recursive: true });
        writeFileSync(path.join(journalFolder, '.gitignore'), '*\n');
        writeFileSync(journal, '');
    } catch {
        journal = null;
    }
    let journalOffset = 0;
    // The bytes of a line that is not complete yet, a character may span two reads
    let journalRest = Buffer.alloc(0);
    let journalReading = false;
    /// Read what was appended to the journal since the last read
    const readJournal = async () => {
        if (journal == null || journalReading) return;
        journalReading = true;
        try {
            const size = statSync(journal).size;
            // A journal that started over is read again
            if (size < journalOffset) {
                journalOffset = 0;
                journalRest = Buffer.alloc(0);
            }
            if (size === journalOffset) return;
            const file = await open(journal, 'r');
            try {
                const bytes = Buffer.alloc(size - journalOffset);
                const { bytesRead } = await file.read(bytes, 0, bytes.length, journalOffset);
                journalOffset += bytesRead;
                const chunk = Buffer.concat([journalRest, bytes.subarray(0, bytesRead)]);
                const end = chunk.lastIndexOf(0x0a);
                journalRest = Buffer.from(chunk.subarray(end + 1));
                const records = parseJournalLines(chunk.subarray(0, end + 1).toString('utf8'));
                for (const record of records) {
                    // The marker names the files of a folder, the server reads their stamps
                    const paths = journalFilePaths(record);
                    const workbook = record.keyValues[JOURNAL_KEYS.workbook];
                    const files = paths == null || typeof workbook !== 'string' ? [] : stampFiles(workbookFolder(options.folder, workbook), paths);
                    state = reduceAgentSessionJournal(state, record, files);
                }
                if (records.length > 0) broadcast();
            } finally {
                await file.close();
            }
        } catch {
            // The journal is gone or unreadable, the next read tries again
        } finally {
            journalReading = false;
        }
    };
    const removeJournal = () => {
        if (journal == null) return;
        rmSync(sessionFolder ?? journal, { force: true, recursive: true });
    };
    const journalTimer = setInterval(() => void readJournal(), JOURNAL_READ_INTERVAL_MS);
    journalTimer.unref();
    const cors = (request: http.IncomingMessage, response: http.ServerResponse): boolean => {
        const origin = request.headers.origin;
        if (origin == null) return true;
        if (!origins.has(origin)) return false;
        response.setHeader('Access-Control-Allow-Origin', origin);
        response.setHeader('Vary', 'Origin');
        response.setHeader('Access-Control-Expose-Headers', EXPOSED_HEADERS);
        return true;
    };
    // The files of the workbooks and the results carry the token in their path, so the relative URLs of a workbook
    // folder (`scripts/a.sql` next to `dashql-workbook.json`) keep it
    const authorized = (request: http.IncomingMessage, url: URL) =>
        request.headers.authorization === `Bearer ${token}` || url.searchParams.get('token') === token
        || pathToken(url) === token;

    // The tab shows the logins that runs wait for
    const unsubscribeLogins = options.auth?.onLogins(logins => {
        state = { ...state, logins, version: state.version + 1 };
        broadcast();
    }) ?? (() => { });

    /// The body of a request
    const readBody = (request: http.IncomingMessage) => new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        request.on('data', chunk => chunks.push(chunk as Buffer));
        request.on('end', () => resolve(Buffer.concat(chunks)));
        request.on('error', reject);
    });
    const sendJson = (response: http.ServerResponse, status: number, value: unknown) =>
        response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(value));

    /// POST /v1/auth/<token>/<connection id> with the connection: a channel of the connection, the user logs in
    /// through the tab if the process has none. Answers the account that the cached results are keyed by, the origins
    /// that the relay reaches and the stand-in responses of the token requests of the login.
    const login = async (request: http.IncomingMessage, response: http.ServerResponse, connectionId: string) => {
        const auth = options.auth;
        if (auth == null) return sendJson(response, 404, { error: 'the session has no logins' });
        let connection: LoginConnection;
        try {
            const body = JSON.parse((await readBody(request)).toString('utf8')) as { name?: unknown; params?: unknown };
            if (loginKind(body.params) == null) throw new Error('no connection that logs in through the tab');
            connection = { connectionId, name: typeof body.name === 'string' ? body.name : connectionId, params: body.params };
        } catch (error) {
            return sendJson(response, 400, { error: String(error) });
        }
        // A login waits for the user, the run asks again after a while: no request outlives the timeouts of fetch
        const authorization = auth.authorization(connection);
        authorization.catch(() => { });
        const waited = await Promise.race([
            authorization.then(value => ({ value }), (error: unknown) => ({ error })),
            new Promise<null>(resolve => setTimeout(() => resolve(null), LOGIN_POLL_MS).unref()),
        ]);
        if (waited == null) return sendJson(response, 202, { waiting: true });
        if ('error' in waited) return sendJson(response, 502, { error: waited.error instanceof Error ? waited.error.message : String(waited.error) });
        const { principal, endpoints, standIns } = waited.value;
        sendJson(response, 200, { principal, origins: Object.keys(endpoints), standIns });
    };

    /// POST /v1/login/<token>/<connection id> from the tab: the answer to a login that waits, the callback of the
    /// redirect page or the credentials of the connection of the tab. They stay in this process.
    const answerLogin = async (request: http.IncomingMessage, response: http.ServerResponse, connectionId: string) => {
        let answer: AgentSessionLoginAnswer;
        try {
            answer = JSON.parse((await readBody(request)).toString('utf8')) as AgentSessionLoginAnswer;
            if (answer == null || typeof answer !== 'object') throw new Error('no answer');
        } catch {
            return void response.writeHead(400).end();
        }
        if (options.auth?.answer(connectionId, answer) !== true) return sendJson(response, 409, { error: 'no login of the connection waits for this answer' });
        response.writeHead(204).end();
    };

    /// /v1/relay/<token>/<connection id> with the URL in X-DashQL-Url: a request of a run to an endpoint of a connection
    /// that it logged in to, with the auth of that endpoint. The tokens stay in this process.
    const relay = async (request: http.IncomingMessage, response: http.ServerResponse, connectionId: string) => {
        const connection = options.auth?.connection(connectionId) ?? null;
        const target = request.headers['x-dashql-url'];
        let url: URL;
        try {
            url = new URL(typeof target === 'string' ? target : '');
        } catch {
            return sendJson(response, 400, { error: 'the relay needs the URL of the request' });
        }
        if (connection == null) return sendJson(response, 403, { error: 'the relay reaches the endpoints of logged in connections only' });
        let authorization;
        try {
            authorization = await options.auth!.authorization(connection);
        } catch (error) {
            return sendJson(response, 502, { error: error instanceof Error ? error.message : String(error) });
        }
        const auth = authorization.endpoints[url.origin];
        if (auth == null) return sendJson(response, 403, { error: 'the relay reaches the endpoints of logged in connections only' });
        const headers = new Headers();
        for (const [name, value] of Object.entries(request.headers)) {
            if (value == null || RELAY_DROPPED_HEADERS.has(name)) continue;
            headers.set(name, Array.isArray(value) ? value.join(', ') : value);
        }
        for (const [name, value] of Object.entries(auth)) headers.set(name, value);
        const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : new Uint8Array(await readBody(request));
        try {
            const forwarded = await (options.fetch ?? fetch)(url, { method: request.method, headers, body });
            const bytes = Buffer.from(await forwarded.arrayBuffer());
            // The headers of the answer go back to the run, e.g. the status of a query of Data Cloud, but not the
            // encoding of the body, which fetch decoded, and not the cookies of the endpoint
            const answered: Record<string, string> = {};
            forwarded.headers.forEach((value, name) => {
                if (!RELAY_DROPPED_RESPONSE_HEADERS.has(name)) answered[name] = value;
            });
            response.writeHead(forwarded.status, answered).end(bytes);
        } catch (error) {
            sendJson(response, 502, { error: error instanceof Error ? error.message : String(error) });
        }
    };

    const handle = (request: http.IncomingMessage, response: http.ServerResponse) => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1');
        // Every answer names the protocol of the server, a client tells by it whether one of the two is too old
        response.setHeader(AGENT_SESSION_PROTOCOL_HEADER, String(AGENT_SESSION_PROTOCOL));
        response.setHeader(AGENT_SESSION_MIN_PROTOCOL_HEADER, String(AGENT_SESSION_MIN_PROTOCOL));
        if (!cors(request, response)) {
            response.writeHead(403).end();
            return;
        }
        if (request.method === 'OPTIONS') {
            response.writeHead(204, {
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
                'Access-Control-Allow-Headers': `Authorization, Content-Type, ${AGENT_SESSION_PROTOCOL_HEADER}`,
                // Chrome asks before a public page reaches the local network
                'Access-Control-Allow-Private-Network': 'true',
            }).end();
            return;
        }
        if (!authorized(request, url)) {
            response.writeHead(401).end();
            return;
        }
        // A client that is too old for the server, or names no protocol, gets nothing else
        const clientProtocol = parseAgentSessionProtocol(request.headers[AGENT_SESSION_PROTOCOL_HEADER.toLowerCase()]);
        if (!serverAcceptsAgentSessionClient(clientProtocol)) {
            sendJson(response, 426, { error: `the server of the session speaks protocol ${AGENT_SESSION_PROTOCOL} with clients of protocol ${AGENT_SESSION_MIN_PROTOCOL} or newer, the client speaks ${clientProtocol ?? 'none'}` });
            return;
        }
        if (request.method === 'POST' && url.pathname === '/v1/events') {
            let body = '';
            request.setEncoding('utf8');
            request.on('data', chunk => { body += chunk; });
            request.on('end', () => {
                let event: AgentSessionEvent;
                try {
                    event = JSON.parse(body) as AgentSessionEvent;
                } catch {
                    response.writeHead(400).end();
                    return;
                }
                state = reduceAgentSessionEvent(state, event);
                // The tools of the harness edit the files of a copy without a dashql command, the page sees their
                // edits after the tool
                if (event.event === 'PostToolUse' || event.event === 'Stop') announceCopies();
                for (const stream of streams) send(stream);
                response.writeHead(204).end();
                if (state.ended) options.onEnd?.();
            });
            return;
        }
        if (request.method === 'POST' && url.pathname.startsWith('/v1/auth/')) {
            const connectionId = decodePart(url.pathname.split('/')[4] ?? '');
            if (connectionId == null || connectionId.length === 0) return void response.writeHead(400).end();
            void login(request, response, connectionId);
            return;
        }
        if (request.method === 'POST' && url.pathname.startsWith('/v1/login/')) {
            const connectionId = decodePart(url.pathname.split('/')[4] ?? '');
            if (connectionId == null || connectionId.length === 0) return void response.writeHead(400).end();
            void answerLogin(request, response, connectionId);
            return;
        }
        if (url.pathname.startsWith('/v1/relay/')) {
            const connectionId = decodePart(url.pathname.split('/')[4] ?? '');
            if (connectionId == null || connectionId.length === 0) return void response.writeHead(400).end();
            void relay(request, response, connectionId);
            return;
        }
        if (request.method === 'PUT' && url.pathname.split('/').length === 4 && url.pathname.startsWith('/v1/connections/')) {
            // /v1/connections/<token>: the connections that the tab lets the agent use, next to the journal, where
            // the commands of the session read them
            let body = '';
            request.setEncoding('utf8');
            request.on('data', chunk => { body += chunk; });
            request.on('end', () => {
                const connections = parseSessionConnections(body);
                if (connections == null) {
                    response.writeHead(400).end();
                    return;
                }
                // How the tab logs in to Salesforce stays in memory, the file names the connections only
                options.auth?.setOAuth(parseAgentSessionOAuth(body));
                try {
                    if (journal == null) throw new Error('the session has no folder');
                    writeFileSync(path.join(path.dirname(journal), SESSION_CONNECTIONS_FILE), `${JSON.stringify(connections, null, 2)}\n`);
                } catch {
                    response.writeHead(500).end();
                    return;
                }
                response.writeHead(204).end();
            });
            return;
        }
        if ((request.method === 'PUT' || request.method === 'DELETE') && url.pathname.startsWith('/v1/workbooks/')) {
            // The copy of the workbook of a page, /v1/workbooks/<token>/<workbook id>[/<path in the folder>]
            const decoded = url.pathname.split('/').slice(4).map(decodePart);
            const [workbookId, ...parts] = decoded;
            if (decoded.includes(null) || workbookId == null || !isWorkbookCopyId(workbookId) || (request.method === 'PUT' && parts.length === 0)) {
                response.writeHead(400).end();
                return;
            }
            const copy = path.join(options.folder, ...workbookCopyPath(workbookId).split('/'));
            if (parts.length === 0) {
                // The whole copy goes, the page writes it again
                rmSync(copy, { recursive: true, force: true });
                state = { ...state, workbooks: state.workbooks.filter(workbook => workbook.workbookId !== workbookId), version: state.version + 1 };
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
                announceCopy(workbookId, copy);
                response.writeHead(204).end();
                return;
            }
            // The file is written next to its place and moved there, a reader never sees half of it
            mkdirSync(path.dirname(file), { recursive: true });
            const part = `${file}.${randomBytes(6).toString('hex')}.part`;
            const out = createWriteStream(part);
            const fail = () => {
                rmSync(part, { force: true });
                if (!response.headersSent) response.writeHead(500);
                response.end();
            };
            request.on('error', fail);
            out.on('error', fail);
            out.on('finish', () => {
                try {
                    renameSync(part, file);
                } catch {
                    fail();
                    return;
                }
                announceCopy(workbookId, copy);
                response.writeHead(204).end();
            });
            request.pipe(out);
            return;
        }
        if (request.method === 'GET' && url.pathname.startsWith('/v1/workbooks/')) {
            // /v1/workbooks/<token>/<workbook id>/<path in the folder>
            const decoded = url.pathname.split('/').slice(4).map(decodePart);
            const [workbookId, ...parts] = decoded;
            const workbook = decoded.includes(null) ? null : state.workbooks.find(other => other.workbookId === workbookId);
            const file = workbook == null ? null : workbookFile(workbookFolder(options.folder, workbook.path), parts as string[]);
            if (file == null) {
                response.writeHead(404).end();
                return;
            }
            sendFile(response, file, contentType(file));
            return;
        }
        if (request.method === 'GET' && url.pathname.startsWith('/v1/results/')) {
            // /v1/results/<token>/<key>: the newest file of a key in the query result cache
            const key = url.pathname.split('/')[4] ?? '';
            const file = newestResultFile(path.join(options.home ?? journalFolder, RESULT_CACHE_FOLDER), key);
            if (file == null) {
                response.writeHead(404).end();
                return;
            }
            response.setHeader('X-DashQL-Cached-At', String(Math.trunc(file.mtimeMs)));
            sendFile(response, file.path, 'application/vnd.apache.parquet');
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
            request.on('close', () => streams.delete(response));
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
        // A port that is taken leaves no journal behind
        clearInterval(keepAlive);
        clearInterval(journalTimer);
        removeJournal();
        throw error;
    }
    return {
        port: (server.address() as { port: number }).port,
        token,
        state: () => state,
        close: () => new Promise<void>(resolve => {
            clearInterval(keepAlive);
            clearInterval(journalTimer);
            // The commands of a later run find no session and append nothing
            removeJournal();
            unsubscribeLogins();
            options.auth?.close();
            for (const stream of streams) stream.end();
            server.close(() => resolve());
        }),
    };
}
