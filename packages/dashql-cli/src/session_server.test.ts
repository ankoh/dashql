import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { LogLevel, type LogRecord } from '@akohn/dashql/platform/logger/log_buffer';
import { JOURNAL_FILES, JOURNAL_KEYS, JOURNAL_TARGET } from '@akohn/dashql/platform/session/workbook_journal';

import { writeAgentSessionConnections, writeAgentSessionWorkbook } from '@akohn/dashql/platform/session/agent_session_client';
import { AGENT_SESSION_MIN_PROTOCOL, AGENT_SESSION_PROTOCOL, fetchAgentSession } from '@akohn/dashql/platform/session/agent_session_protocol';

import { startSessionServer, type SessionServer } from './session_server.js';

const temp = (prefix: string) => mkdtempSync(path.join(process.env.TEST_TMPDIR ?? tmpdir(), prefix));

/// Wait until a condition holds, the server reads the journal every 200 ms
async function until(condition: () => boolean): Promise<void> {
    for (let i = 0; i < 100 && !condition(); ++i) await new Promise(resolve => setTimeout(resolve, 50));
    expect(condition()).toBe(true);
}

/// A record of the log of a command, as it reaches the journal
const record = (message: string, target: string, keyValues: LogRecord['keyValues']): LogRecord =>
    ({ timestamp: 1, level: LogLevel.Info, target, message, context: null, tracing: null, keyValues });

describe('the session server', () => {
    let server: SessionServer | null = null;
    afterEach(async () => {
        await server?.close();
        server = null;
    });

    it('creates the journal, follows its lines and hands out the files they name', async () => {
        const folder = temp('dashql-session-');
        mkdirSync(path.join(folder, 'orders', 'scripts'), { recursive: true });
        writeFileSync(path.join(folder, 'orders', 'dashql-workbook.json'), '{}');
        writeFileSync(path.join(folder, 'orders', 'scripts', 'a.sql'), 'select 1\n');
        writeFileSync(path.join(folder, 'secret.txt'), 'no');

        server = await startSessionServer({ harness: 'claude', folder });
        const journal = path.join(folder, '.dashql', 'journal.jsonl');
        expect(readFileSync(journal, 'utf8')).toBe('');
        expect(readFileSync(path.join(folder, '.dashql', '.gitignore'), 'utf8')).toBe('*\n');

        const workbook = { [JOURNAL_KEYS.workbook]: 'orders', [JOURNAL_KEYS.workbookId]: 'w1' };
        const entries: LogRecord[] = [
            record(JOURNAL_FILES, JOURNAL_TARGET, { ...workbook, [JOURNAL_KEYS.files]: ['dashql-workbook.json', 'scripts/a.sql', 'scripts/gone_ä.sql'] }),
            record('Executed query', 'query_executor', { numRows: '1' }),
        ];
        // A line arrives in two writes, the second one in the middle of a character, the server waits for its end
        const bytes = Buffer.from(entries.map(entry => `${JSON.stringify(entry)}\n`).join(''));
        const split = bytes.indexOf(Buffer.from('ä')) + 1;
        appendFileSync(journal, bytes.subarray(0, split));
        await new Promise(resolve => setTimeout(resolve, 300));
        expect(server.state().workbooks).toEqual([]);
        appendFileSync(journal, bytes.subarray(split));
        await until(() => server!.state().log.length === 1);
        // The server read the stamps of the files that exist
        expect(server.state().workbooks[0]).toMatchObject({ path: 'orders', workbookId: 'w1' });
        expect(server.state().workbooks[0].files.map(file => [file.path, file.size])).toEqual([['dashql-workbook.json', 2], ['scripts/a.sql', 9]]);
        expect(server.state().log.map(r => r.message)).toEqual(['Executed query']);

        const base = `http://127.0.0.1:${server.port}`;
        const file = await fetchAgentSession(`${base}/v1/workbooks/${server.token}/w1/scripts/a.sql`);
        expect(file.status).toBe(200);
        expect(await file.text()).toBe('select 1\n');
        expect((await fetchAgentSession(`${base}/v1/workbooks/${server.token}/w1/dashql-workbook.json`)).status).toBe(200);
        // Only the files of a workbook folder, only with the token
        expect((await fetchAgentSession(`${base}/v1/workbooks/${server.token}/w1/../secret.txt`)).status).toBe(404);
        expect((await fetchAgentSession(`${base}/v1/workbooks/${server.token}/w1/scripts/%2E%2E/%2E%2E/secret.txt`)).status).toBe(404);
        expect((await fetchAgentSession(`${base}/v1/workbooks/${server.token}/w2/scripts/a.sql`)).status).toBe(404);
        expect((await fetchAgentSession(`${base}/v1/workbooks/wrong/w1/scripts/a.sql`)).status).toBe(401);
        // A workbook folder outside the folder of the session is not handed out
        writeFileSync(path.join(folder, '..', 'outside.sql'), 'no');
        appendFileSync(journal, `${JSON.stringify(record(JOURNAL_FILES, JOURNAL_TARGET, { [JOURNAL_KEYS.workbook]: '..', [JOURNAL_KEYS.workbookId]: 'w9', [JOURNAL_KEYS.files]: ['dashql-workbook.json'] }))}\n`);
        await until(() => server!.state().workbooks.some(workbook => workbook.workbookId === 'w9'));
        expect(server.state().workbooks.find(workbook => workbook.workbookId === 'w9')?.files).toEqual([]);
        expect((await fetchAgentSession(`${base}/v1/workbooks/${server.token}/w9/dashql-workbook.json`)).status).toBe(404);

        // A stopped server leaves no journal, later commands find no session
        await server.close();
        server = null;
        expect(existsSync(journal)).toBe(false);
    });

    it('keeps the journal of a session of dashql connect in a folder of its own', async () => {
        const folder = temp('dashql-session-');
        // Two sessions in one folder, each has its journal, the first that stops leaves the other one
        const first = await startSessionServer({ harness: 'claude', folder, session: '51001' });
        server = await startSessionServer({ harness: 'codex', folder, session: '51002' });
        const second = server;
        const journal = (session: string) => path.join(folder, '.dashql', 'sessions', session, 'journal.jsonl');
        try {
            expect(readFileSync(journal('51001'), 'utf8')).toBe('');
            expect(readFileSync(journal('51002'), 'utf8')).toBe('');
            expect(existsSync(path.join(folder, '.dashql', 'journal.jsonl'))).toBe(false);
            expect(readFileSync(path.join(folder, '.dashql', '.gitignore'), 'utf8')).toBe('*\n');
            appendFileSync(journal('51002'), `${JSON.stringify(record(JOURNAL_FILES, JOURNAL_TARGET, { [JOURNAL_KEYS.workbook]: '.', [JOURNAL_KEYS.workbookId]: 'w1', [JOURNAL_KEYS.files]: [] }))}\n`);
            await until(() => second.state().workbooks.length === 1);
            expect(first.state().workbooks).toEqual([]);
            await first.close();
            expect(existsSync(path.join(folder, '.dashql', 'sessions', '51001'))).toBe(false);
            expect(existsSync(journal('51002'))).toBe(true);
        } finally {
            if (existsSync(journal('51001'))) await first.close();
        }
        await second.close();
        server = null;
        expect(existsSync(path.join(folder, '.dashql', 'sessions', '51002'))).toBe(false);
        await expect(startSessionServer({ harness: 'claude', folder, session: '../x' })).rejects.toThrow('invalid session name');
    });

    it('keeps the copy of the workbook of a page in its folder and hands out its files', async () => {
        const folder = temp('dashql-session-');
        server = await startSessionServer({ harness: 'claude', folder, session: '51003' });
        const target = { endpoint: `http://127.0.0.1:${server.port}`, token: server.token };
        const copy = path.join(folder, '.dashql', 'workbooks', 'w1');
        const parquet = new Uint8Array([0x50, 0x41, 0x52, 0x31]);
        await writeAgentSessionWorkbook(target, 'w1', [
            { path: 'dashql-workbook.json', content: '{"scripts":[]}' },
            { path: 'scripts/a.sql', content: 'select 1\n' },
            { path: 'attachments/t.parquet', content: parquet },
        ]);
        expect(readFileSync(path.join(copy, 'scripts', 'a.sql'), 'utf8')).toBe('select 1\n');
        expect(new Uint8Array(readFileSync(path.join(copy, 'attachments', 't.parquet')))).toEqual(parquet);
        // The state names the copy like a workbook folder of the journal, the page fetches its files from there
        expect(server.state().workbooks).toMatchObject([{ path: '.dashql/workbooks/w1', workbookId: 'w1' }]);
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
        const event = { event: 'PostToolUse', harness: 'claude', folder, status: 'Edit', files: [] };
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
        const preflight = await fetchAgentSession(`${base}/scripts/a.sql`, { method: 'OPTIONS', headers: { Origin: 'https://dashql.app' } });
        expect(preflight.headers.get('access-control-allow-methods')).toContain('PUT');

        // The whole copy goes, the state forgets it
        expect((await fetchAgentSession(base, { method: 'DELETE' })).status).toBe(204);
        expect(existsSync(copy)).toBe(false);
        expect(server.state().workbooks).toEqual([]);
    });

    it('keeps the connections that the tab lets the agent use next to the journal of the session', async () => {
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
        const server = await startSessionServer({ harness: 'claude', folder: temp('dashql-session-') });
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

    it('names its protocol on every answer and answers clients of an older protocol with nothing', async () => {
        server = await startSessionServer({ harness: 'claude', folder: temp('dashql-session-') });
        const base = `http://127.0.0.1:${server.port}`;
        // A page reads the protocols of every answer, also of an error
        for (const answer of [
            await fetchAgentSession(`${base}/v1/state?token=${server.token}`, { headers: { Origin: 'https://dashql.app' } }),
            await fetchAgentSession(`${base}/v1/state?token=wrong`, { headers: { Origin: 'https://dashql.app' } }),
        ]) {
            expect(answer.headers.get('x-dashql-protocol')).toBe(String(AGENT_SESSION_PROTOCOL));
            expect(answer.headers.get('x-dashql-min-protocol')).toBe(String(AGENT_SESSION_MIN_PROTOCOL));
            expect(answer.headers.get('access-control-expose-headers')).toContain('X-DashQL-Protocol');
            expect(answer.headers.get('access-control-expose-headers')).toContain('X-DashQL-Min-Protocol');
        }
        // A page sends the protocol with every request, the preflight allows it
        const preflight = await fetch(`${base}/v1/stream`, { method: 'OPTIONS', headers: { Origin: 'https://dashql.app', 'Access-Control-Request-Headers': 'x-dashql-protocol' } });
        expect(preflight.headers.get('access-control-allow-headers')).toContain('X-DashQL-Protocol');
        // A client without a protocol or of one that is too old gets nothing but the protocols of the server
        const events = `${base}/v1/events`;
        const event = JSON.stringify({ event: 'UserPromptSubmit', harness: 'claude', folder: '/w', prompt: 'q' });
        const headers = { Authorization: `Bearer ${server.token}` };
        const none = await fetch(events, { method: 'POST', headers, body: event });
        expect(none.status).toBe(426);
        expect(none.headers.get('x-dashql-protocol')).toBe(String(AGENT_SESSION_PROTOCOL));
        expect((await fetch(events, { method: 'POST', headers: { ...headers, 'X-DashQL-Protocol': String(AGENT_SESSION_MIN_PROTOCOL - 1) }, body: event })).status).toBe(426);
        expect((await fetch(events, { method: 'POST', headers: { ...headers, 'X-DashQL-Protocol': 'x' }, body: event })).status).toBe(426);
        expect(server.state().turns).toEqual([]);
        // A newer client works with the server as long as the server is not older than its oldest
        expect((await fetch(events, { method: 'POST', headers: { ...headers, 'X-DashQL-Protocol': String(AGENT_SESSION_PROTOCOL + 1) }, body: event })).status).toBe(204);
        expect(server.state().turns.map(turn => turn.question)).toEqual(['q']);
    });

    it('answers malformed paths without ending', async () => {
        server = await startSessionServer({ harness: 'claude', folder: temp('dashql-session-') });
        const base = `http://127.0.0.1:${server.port}`;
        expect((await fetchAgentSession(`${base}/v1/workbooks/%E0/x`)).status).toBe(401);
        expect((await fetchAgentSession(`${base}/v1/workbooks/${server.token}/%E0/x`)).status).toBe(404);
        expect((await fetchAgentSession(`${base}/v1/state?token=${server.token}`)).status).toBe(200);
    });

    it('follows the conversation in a folder without a journal', async () => {
        server = await startSessionServer({ harness: 'claude', folder: path.join(temp('dashql-session-'), 'missing', '\0') });
        expect(server.state().workbooks).toEqual([]);
        expect(existsSync(path.join(server.state().folder, '.dashql'))).toBe(false);
    });
});
