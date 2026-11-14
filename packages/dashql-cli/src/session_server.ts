import http from 'node:http';
import { randomBytes } from 'node:crypto';

import { createAgentSessionState, reduceAgentSessionEvent, type AgentSessionEvent, type AgentSessionState } from '@ankoh/dashql-sdk/session/agent_session_state';

/// The pages that may follow a session: the web app, its dev server and the desktop app
export const SESSION_PAGE_ORIGINS = ['https://dashql.app', 'http://localhost:9002', 'http://127.0.0.1:9002', 'app://bundle'];

export interface SessionServerOptions {
    harness: string;
    folder: string;
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

/// Start the server of a session on 127.0.0.1. Hooks post the events of the harness to /v1/events, pages follow its
/// state on /v1/stream as server-sent events. Every request carries the token, pages in the query since an
/// EventSource sends no headers.
export async function startSessionServer(options: SessionServerOptions): Promise<SessionServer> {
    const token = options.token ?? randomBytes(24).toString('base64url');
    const origins = new Set(options.origins ?? SESSION_PAGE_ORIGINS);
    let state = createAgentSessionState(options.harness, options.folder);
    const streams = new Set<http.ServerResponse>();

    const send = (response: http.ServerResponse) => response.write(`data: ${JSON.stringify(state)}\n\n`);
    const cors = (request: http.IncomingMessage, response: http.ServerResponse): boolean => {
        const origin = request.headers.origin;
        if (origin == null) return true;
        if (!origins.has(origin)) return false;
        response.setHeader('Access-Control-Allow-Origin', origin);
        response.setHeader('Vary', 'Origin');
        return true;
    };
    const authorized = (request: http.IncomingMessage, url: URL) =>
        request.headers.authorization === `Bearer ${token}` || url.searchParams.get('token') === token;

    const server = http.createServer((request, response) => {
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
            for (const stream of streams) stream.end();
            server.close(() => resolve());
        }),
    };
}
