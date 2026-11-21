import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { writeAgentSessionConnections, writeAgentSessionWorkbook } from '@akohn/dashql/platform/session/agent_session_client';
import { AGENT_SESSION_PROTOCOL, fetchAgentSession } from '@akohn/dashql/platform/session/agent_session_protocol';

import { startSessionServer, type SessionServer } from './session_server.js';

const temp = (prefix: string) => mkdtempSync(path.join(process.env.TEST_TMPDIR ?? tmpdir(), prefix));

describe('the session server', () => {
    let server: SessionServer | null = null;
    afterEach(async () => {
        await server?.close();
        server = null;
    });

    it('keeps the address of the server in the folder of the session, which goes with the session', async () => {
        const folder = temp('dashql-session-');
        // Two sessions in one folder, each has its folder, the first that stops leaves the other one
        const first = await startSessionServer({ harness: 'claude', folder, session: '51001' });
        server = await startSessionServer({ harness: 'codex', folder, session: '51002' });
        const second = server;
        const sessionFolder = (session: string) => path.join(folder, '.dashql', 'sessions', session);
        try {
            expect(readFileSync(path.join(folder, '.dashql', '.gitignore'), 'utf8')).toBe('*\n');
            // The commands of the agent find the server in the folder of the session, only the user reads it
            const address = path.join(sessionFolder('51002'), 'server.json');
            expect(JSON.parse(readFileSync(address, 'utf8'))).toEqual({ endpoint: `http://127.0.0.1:${second.port}`, token: second.token });
            expect(statSync(address).mode & 0o077).toBe(0);
            // Every server names its session by its id, a page tells the next session on a port by it
            expect(first.state().id).toBe('51001');
            expect(second.state().id).toBe('51002');
            await first.close();
            expect(existsSync(sessionFolder('51001'))).toBe(false);
            expect(existsSync(sessionFolder('51002'))).toBe(true);
        } finally {
            if (existsSync(sessionFolder('51001'))) await first.close();
        }
        await second.close();
        server = null;
        expect(existsSync(sessionFolder('51002'))).toBe(false);
        await expect(startSessionServer({ harness: 'claude', folder, session: '../x' })).rejects.toThrow('invalid session name');
    });

    it('keeps the copy of the workbook of a page in its folder and hands out its files', async () => {
        const folder = temp('dashql-session-');
        server = await startSessionServer({ harness: 'claude', folder, session: '51003' });
        const target = { endpoint: `http://127.0.0.1:${server.port}`, token: server.token };
        // The copies are in the folder of the session
        const copy = path.join(folder, '.dashql', 'sessions', '51003', 'workbooks', 'w1');
        const parquet = new Uint8Array([0x50, 0x41, 0x52, 0x31]);
        await writeAgentSessionWorkbook(target, 'w1', [
            { path: 'dashql-workbook.json', content: '{"scripts":[]}' },
            { path: 'scripts/a.sql', content: 'select 1\n' },
            { path: 'attachments/t.parquet', content: parquet },
        ]);
        expect(readFileSync(path.join(copy, 'scripts', 'a.sql'), 'utf8')).toBe('select 1\n');
        expect(new Uint8Array(readFileSync(path.join(copy, 'attachments', 't.parquet')))).toEqual(parquet);
        // The state names the copy with the stamps of its files, the page fetches its files from the server
        expect(server.state().workbooks).toMatchObject([{ workbookId: 'w1' }]);
        expect(server.state().workbooks[0].files.map(file => file.path)).toEqual(['dashql-workbook.json', 'scripts/a.sql', 'attachments/t.parquet']);
        const base = `http://127.0.0.1:${server.port}/v1/workbooks/${server.token}/w1`;
        expect(await (await fetchAgentSession(`${base}/scripts/a.sql`)).text()).toBe('select 1\n');

        // A new copy replaces the old one, the scripts that the page no longer has are gone
        await writeAgentSessionWorkbook(target, 'w1', [
            { path: 'dashql-workbook.json', content: '{"scripts":[]}' },
            { path: 'scripts/b.sql', content: 'select 2\n' },
        ]);
        expect(existsSync(path.join(copy, 'scripts', 'a.sql'))).toBe(false);
        expect(server.state().workbooks[0].files.map(file => file.path)).toEqual(['dashql-workbook.json', 'scripts/b.sql']);
        // The agent edits the copy with a tool of its harness, the stamps follow after the tool
        const stamp = () => server!.state().workbooks[0].files.find(file => file.path === 'scripts/b.sql');
        const before = stamp();
        writeFileSync(path.join(copy, 'scripts', 'b.sql'), 'select 22, 23\n');
        const event = { event: 'PostToolUse', status: 'Edit', files: [] };
        const posted = await fetchAgentSession(`http://127.0.0.1:${server.port}/v1/events`, { method: 'POST', headers: { Authorization: `Bearer ${server.token}` }, body: JSON.stringify(event) });
        expect(posted.status).toBe(204);
        expect(stamp()?.size).toBe(14);
        expect(stamp()).not.toEqual(before);

        // A file of the copy can go on its own
        expect((await fetchAgentSession(`${base}/scripts/b.sql`, { method: 'DELETE' })).status).toBe(204);
        expect(server.state().workbooks[0].files.map(file => file.path)).toEqual(['dashql-workbook.json']);

        // Only the files of a workbook folder, only with the token, only into the folder of the copy
        expect((await fetchAgentSession(`${base}/secret.txt`, { method: 'PUT', body: 'no' })).status).toBe(400);
        expect((await fetchAgentSession(`${base}/scripts/..%2F..%2Fx.sql`, { method: 'PUT', body: 'no' })).status).toBe(400);
        expect((await fetchAgentSession(`http://127.0.0.1:${server.port}/v1/workbooks/${server.token}/..%2Fx/scripts/a.sql`, { method: 'PUT', body: 'no' })).status).toBe(400);
        expect((await fetchAgentSession(`http://127.0.0.1:${server.port}/v1/workbooks/wrong/w1/scripts/a.sql`, { method: 'PUT', body: 'no' })).status).toBe(401);
        // Only the files of a copy go out, only with the token
        writeFileSync(path.join(folder, 'secret.txt'), 'no');
        expect((await fetchAgentSession(`${base}/../secret.txt`)).status).toBe(404);
        expect((await fetchAgentSession(`${base}/scripts/%2E%2E/%2E%2E/secret.txt`)).status).toBe(404);
        expect((await fetchAgentSession(`http://127.0.0.1:${server.port}/v1/workbooks/${server.token}/w2/scripts/a.sql`)).status).toBe(404);
        expect((await fetchAgentSession(`http://127.0.0.1:${server.port}/v1/workbooks/wrong/w1/dashql-workbook.json`)).status).toBe(401);
        const preflight = await fetchAgentSession(`${base}/scripts/a.sql`, { method: 'OPTIONS', headers: { Origin: 'https://dashql.app' } });
        expect(preflight.headers.get('access-control-allow-methods')).toContain('PUT');

        // The whole copy goes, the state forgets it
        expect((await fetchAgentSession(base, { method: 'DELETE' })).status).toBe(204);
        expect(existsSync(copy)).toBe(false);
        expect(server.state().workbooks).toEqual([]);
    });

    it('keeps the connections that the tab lets the agent use in the folder of the session', async () => {
        const folder = temp('dashql-session-');
        server = await startSessionServer({ harness: 'claude', folder, session: '51005' });
        const target = { endpoint: `http://127.0.0.1:${server.port}`, token: server.token };
        await writeAgentSessionConnections(target, { connections: [{ connectionId: 'c1', name: 'Trino prod' }] });
        const file = path.join(folder, '.dashql', 'sessions', '51005', 'connections.json');
        expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ connections: [{ connectionId: 'c1', name: 'Trino prod' }] });
        const base = `http://127.0.0.1:${server.port}/v1/connections`;
        expect((await fetchAgentSession(`${base}/${server.token}`, { method: 'PUT', body: '{"connections":7}' })).status).toBe(400);
        expect((await fetchAgentSession(`${base}/wrong`, { method: 'PUT', body: '{"connections":[]}' })).status).toBe(401);
        // None is a choice as well
        await writeAgentSessionConnections(target, { connections: [] });
        expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ connections: [] });
    });

    it('serves the state only with the token and to the pages of DashQL', async () => {
        const server = await startSessionServer({ harness: 'claude', folder: temp('dashql-session-'), session: '51009' });
        try {
            const base = `http://127.0.0.1:${server.port}`;
            expect((await fetchAgentSession(`${base}/v1/state`)).status).toBe(401);
            expect((await fetchAgentSession(`${base}/v1/state?token=${server.token}`)).status).toBe(200);
            expect((await fetchAgentSession(`${base}/v1/state?token=${server.token}`, { headers: { Origin: 'https://evil.example' } })).status).toBe(403);
            for (const origin of ['https://dashql.app', 'https://stable.dashql.app', 'https://dev.dashql.app']) {
                const page = await fetchAgentSession(`${base}/v1/state?token=${server.token}`, { headers: { Origin: origin } });
                expect(page.headers.get('access-control-allow-origin')).toBe(origin);
            }
            const preflight = await fetchAgentSession(`${base}/v1/events`, { method: 'OPTIONS', headers: { Origin: 'http://localhost:9002' } });
            expect(preflight.status).toBe(204);
            expect(preflight.headers.get('access-control-allow-private-network')).toBe('true');
        } finally {
            await server.close();
        }
    });

    it('names its protocol on every answer', async () => {
        server = await startSessionServer({ harness: 'claude', folder: temp('dashql-session-'), session: '51009' });
        const base = `http://127.0.0.1:${server.port}`;
        // A page reads the protocol of every answer, also of an error
        for (const answer of [
            await fetchAgentSession(`${base}/v1/state?token=${server.token}`, { headers: { Origin: 'https://dashql.app' } }),
            await fetchAgentSession(`${base}/v1/state?token=wrong`, { headers: { Origin: 'https://dashql.app' } }),
        ]) {
            expect(answer.headers.get('x-dashql-protocol')).toBe(String(AGENT_SESSION_PROTOCOL));
            expect(answer.headers.get('access-control-expose-headers')).toBe('X-DashQL-Protocol');
        }
        // A request names no protocol, the server takes it as it is
        const event = JSON.stringify({ event: 'UserPromptSubmit', prompt: 'q' });
        const posted = await fetch(`${base}/v1/events`, { method: 'POST', headers: { Authorization: `Bearer ${server.token}` }, body: event });
        expect(posted.status).toBe(204);
        expect(posted.headers.get('x-dashql-protocol')).toBe(String(AGENT_SESSION_PROTOCOL));
        expect(server.state().turns.map(turn => turn.question)).toEqual(['q']);
    });

    it('answers malformed paths without ending', async () => {
        server = await startSessionServer({ harness: 'claude', folder: temp('dashql-session-'), session: '51009' });
        const base = `http://127.0.0.1:${server.port}`;
        expect((await fetchAgentSession(`${base}/v1/workbooks/%E0/x`)).status).toBe(401);
        expect((await fetchAgentSession(`${base}/v1/workbooks/${server.token}/%E0/x`)).status).toBe(404);
        expect((await fetchAgentSession(`${base}/v1/state?token=${server.token}`)).status).toBe(200);
    });

    it('does not start in a folder that it cannot write', async () => {
        const folder = path.join(temp('dashql-session-'), 'missing', '\0');
        await expect(startSessionServer({ harness: 'claude', folder, session: '51009' })).rejects.toThrow(/^cannot write /);
    });
});
