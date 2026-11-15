import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { createReadStream, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';

import { createAgentSessionState, reduceAgentSessionEvent, reduceAgentSessionJournal, type AgentSessionEvent, type AgentSessionState } from '@ankoh/dashql-runtime/session/agent_session_state';
import { JOURNAL_KEYS, journalFilePaths, parseJournalLines, SESSION_JOURNAL_FILE, SESSION_JOURNAL_FOLDER, type JournalFile } from '@ankoh/dashql-runtime/session/workbook_journal';

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
    /// The pages that may follow the session, besides requests without an origin
    origins?: string[];
    /// Called when the harness ended the session
    onEnd?: () => void;
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
    return parts[1] === 'v1' && (parts[2] === 'workbooks' || parts[2] === 'results') ? decodePart(parts[3] ?? '') : null;
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

    // The journal of the session starts empty, dashql commands below the folder append to it. The folder ignores
    // itself, it is no part of a repository of the folder.
    // A folder that the server can't write to has no journal, the page still follows the conversation.
    const journalFolder = path.join(options.folder, SESSION_JOURNAL_FOLDER);
    let journal: string | null = path.join(journalFolder, SESSION_JOURNAL_FILE);
    try {
        mkdirSync(journalFolder, { recursive: true });
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
    const journalTimer = setInterval(() => void readJournal(), JOURNAL_READ_INTERVAL_MS);
    journalTimer.unref();
    const cors = (request: http.IncomingMessage, response: http.ServerResponse): boolean => {
        const origin = request.headers.origin;
        if (origin == null) return true;
        if (!origins.has(origin)) return false;
        response.setHeader('Access-Control-Allow-Origin', origin);
        response.setHeader('Vary', 'Origin');
        return true;
    };
    // The files of the workbooks and the results carry the token in their path, so the relative URLs of a workbook
    // folder (`scripts/a.sql` next to `dashql-workbook.json`) keep it
    const authorized = (request: http.IncomingMessage, url: URL) =>
        request.headers.authorization === `Bearer ${token}` || url.searchParams.get('token') === token
        || pathToken(url) === token;

    const handle = (request: http.IncomingMessage, response: http.ServerResponse) => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1');
        if (!cors(request, response)) {
            response.writeHead(403).end();
            return;
        }
        if (request.method === 'OPTIONS') {
            response.writeHead(204, {
                'Access-Control-Allow-Methods': 'GET, POST',
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
                for (const stream of streams) send(stream);
                response.writeHead(204).end();
                if (state.ended) options.onEnd?.();
            });
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
            response.setHeader('Access-Control-Expose-Headers', 'X-DashQL-Cached-At');
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
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(options.port ?? 0, '127.0.0.1', () => resolve());
    });
    return {
        port: (server.address() as { port: number }).port,
        token,
        state: () => state,
        close: () => new Promise<void>(resolve => {
            clearInterval(keepAlive);
            clearInterval(journalTimer);
            // The commands of a later run find no session and append nothing
            if (journal != null) rmSync(journal, { force: true });
            for (const stream of streams) stream.end();
            server.close(() => resolve());
        }),
    };
}
