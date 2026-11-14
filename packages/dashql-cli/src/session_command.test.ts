import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runSession, sessionLink, type SessionEnvironment } from './session_command.js';
import { startSessionServer, type SessionServer } from './session_server.js';
import { runWith } from './test_process.js';

/// An environment whose server runs in the process of the test
function testEnvironment(): { env: SessionEnvironment; servers: SessionServer[] } {
    const home = mkdtempSync(path.join(process.env.TEST_TMPDIR ?? tmpdir(), 'dashql-sessions-'));
    const servers: SessionServer[] = [];
    const env: SessionEnvironment = {
        home,
        appUrl: 'http://localhost:9002',
        startServer: args => {
            const named = new Map<string, string>();
            for (let i = 0; i < args.length; i += 2) named.set(args[i].slice(2), args[i + 1]);
            // The server of the test writes its file like `dashql session serve`
            void startSessionServer({ harness: named.get('harness')!, folder: named.get('folder')! }).then(async server => {
                servers.push(server);
                const { writeFileSync } = await import('node:fs');
                writeFileSync(path.join(home, `${named.get('session')}.json`), JSON.stringify({ session: named.get('session'), port: server.port, token: server.token, pid: process.pid }));
            });
        },
    };
    return { env, servers };
}

const hook = (env: SessionEnvironment, event: string, payload: object) =>
    runWith((args, cli) => runSession(args, cli, env), '/w', ['hook', event, '--harness', 'claude'], JSON.stringify(payload));

describe('dashql session', () => {
    it('starts the server of a session with its first event and sends the events to it', async () => {
        const { env, servers } = testEnvironment();
        try {
            const start = await hook(env, 'SessionStart', { session_id: 's1', cwd: '/w' });
            expect(start.code).toBe(0);
            expect(servers).toHaveLength(1);
            expect(start.stdout).toBe(`DashQL shows this session at ${sessionLink(env.appUrl, servers[0])}\n`);
            await hook(env, 'UserPromptSubmit', { session_id: 's1', cwd: '/w', prompt: 'how many orders' });
            await hook(env, 'PostToolUse', { session_id: 's1', cwd: '/w', tool_name: 'Bash', tool_input: { command: 'dashql lint a.sql' } });
            await hook(env, 'Stop', { session_id: 's1', cwd: '/w', last_assistant_message: '42' });
            expect(servers).toHaveLength(1);
            expect(servers[0].state()).toMatchObject({
                harness: 'claude',
                folder: '/w',
                turns: [{ turnId: 1, question: 'how many orders', status: null, note: '42', files: ['a.sql'] }],
            });
            const link = await runWith((args, cli) => runSession(args, cli, env), '/w', ['link']);
            expect(link.stdout).toBe(`${sessionLink(env.appUrl, servers[0])}\n`);
        } finally {
            for (const server of servers) await server.close();
        }
    });

    it('never fails the harness', async () => {
        const { env } = testEnvironment();
        // An event without a server ends nothing, an unknown event is ignored, a broken payload still counts
        expect((await hook(env, 'SessionEnd', { session_id: 'gone' })).code).toBe(0);
        expect((await hook(env, 'PreToolUse', {})).code).toBe(0);
        expect((await runWith((args, cli) => runSession(args, cli, env), '/w', ['hook', 'PreToolUse', '--harness'])).code).toBe(0);
        expect(readdirSync(env.home)).toEqual([]);
    });

    it('serves the state only with the token and to the pages of DashQL', async () => {
        const server = await startSessionServer({ harness: 'claude', folder: '/w' });
        try {
            const base = `http://127.0.0.1:${server.port}`;
            expect((await fetch(`${base}/v1/state`)).status).toBe(401);
            expect((await fetch(`${base}/v1/state?token=${server.token}`)).status).toBe(200);
            expect((await fetch(`${base}/v1/state?token=${server.token}`, { headers: { Origin: 'https://evil.example' } })).status).toBe(403);
            const page = await fetch(`${base}/v1/state?token=${server.token}`, { headers: { Origin: 'https://dashql.app' } });
            expect(page.headers.get('access-control-allow-origin')).toBe('https://dashql.app');
            const preflight = await fetch(`${base}/v1/events`, { method: 'OPTIONS', headers: { Origin: 'http://localhost:9002' } });
            expect(preflight.status).toBe(204);
            expect(preflight.headers.get('access-control-allow-private-network')).toBe('true');
        } finally {
            await server.close();
        }
    });
});
