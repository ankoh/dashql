import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { LogLevel, type LogRecord } from '@ankoh/dashql-runtime/platform/logger/log_buffer';
import { JOURNAL_FILES, JOURNAL_KEYS, JOURNAL_SCRIPT_RESULT, JOURNAL_TARGET } from '@ankoh/dashql-runtime/session/workbook_journal';

import { startSessionServer, type SessionServer } from './session_server.js';

const temp = (prefix: string) => mkdtempSync(path.join(process.env.TEST_TMPDIR ?? tmpdir(), prefix));

/// Wait until a condition holds, the server reads the journal every 200 ms
async function until(condition: () => boolean): Promise<void> {
    for (let i = 0; i < 100 && !condition(); ++i) await new Promise(resolve => setTimeout(resolve, 50));
    expect(condition()).toBe(true);
}

describe('the journal of the session server', () => {
    let server: SessionServer | null = null;
    afterEach(async () => {
        await server?.close();
        server = null;
    });

    it('creates the journal, follows its lines and hands out the files and results they name', async () => {
        const folder = temp('dashql-session-');
        // The commands below the folder keep their files in its .dashql/, the server hands out the results there
        const home = path.join(folder, '.dashql');
        mkdirSync(path.join(folder, 'orders', 'scripts'), { recursive: true });
        writeFileSync(path.join(folder, 'orders', 'dashql-workbook.json'), '{}');
        writeFileSync(path.join(folder, 'orders', 'scripts', 'a.sql'), 'select 1\n');
        writeFileSync(path.join(folder, 'secret.txt'), 'no');
        const key = 'a'.repeat(64);
        mkdirSync(path.join(home, 'cache'), { recursive: true });
        writeFileSync(path.join(home, 'cache', `${key}.00000000-0000-4000-8000-000000000001.parquet`), 'older');
        await new Promise(resolve => setTimeout(resolve, 20));
        writeFileSync(path.join(home, 'cache', `${key}.00000000-0000-4000-8000-000000000002.parquet`), 'newer');

        server = await startSessionServer({ harness: 'claude', folder });
        const journal = path.join(folder, '.dashql', 'journal.jsonl');
        expect(readFileSync(journal, 'utf8')).toBe('');
        expect(readFileSync(path.join(folder, '.dashql', '.gitignore'), 'utf8')).toBe('*\n');

        const record = (message: string, target: string, keyValues: LogRecord['keyValues']): LogRecord =>
            ({ timestamp: 1, level: LogLevel.Info, target, message, context: null, tracing: null, keyValues });
        const workbook = { [JOURNAL_KEYS.workbook]: 'orders', [JOURNAL_KEYS.workbookId]: 'w1' };
        const entries: LogRecord[] = [
            record(JOURNAL_FILES, JOURNAL_TARGET, { ...workbook, [JOURNAL_KEYS.files]: ['dashql-workbook.json', 'scripts/a.sql', 'scripts/gone.sql'] }),
            record('Executed query', 'query_executor', { numRows: '1' }),
            record(JOURNAL_SCRIPT_RESULT, JOURNAL_TARGET, { ...workbook, [JOURNAL_KEYS.script]: 'a.sql', [JOURNAL_KEYS.key]: key, [JOURNAL_KEYS.resultRows]: '1' }),
        ];
        // A line arrives in two writes, the server waits for its end
        const lines = entries.map(entry => `${JSON.stringify(entry)}\n`).join('');
        appendFileSync(journal, lines.slice(0, 30));
        await new Promise(resolve => setTimeout(resolve, 300));
        expect(server.state().workbooks).toEqual([]);
        appendFileSync(journal, lines.slice(30));
        await until(() => server!.state().workbooks[0]?.results.length === 1);
        // The server read the stamps of the files that exist
        expect(server.state().workbooks[0]).toMatchObject({ path: 'orders', workbookId: 'w1' });
        expect(server.state().workbooks[0].files.map(file => [file.path, file.size])).toEqual([['dashql-workbook.json', 2], ['scripts/a.sql', 9]]);
        expect(server.state().log.map(r => r.message)).toEqual(['Executed query']);

        const base = `http://127.0.0.1:${server.port}`;
        const file = await fetch(`${base}/v1/workbooks/${server.token}/w1/scripts/a.sql`);
        expect(file.status).toBe(200);
        expect(await file.text()).toBe('select 1\n');
        expect((await fetch(`${base}/v1/workbooks/${server.token}/w1/dashql-workbook.json`)).status).toBe(200);
        // Only the files of a workbook folder, only with the token
        expect((await fetch(`${base}/v1/workbooks/${server.token}/w1/../secret.txt`)).status).toBe(404);
        expect((await fetch(`${base}/v1/workbooks/${server.token}/w1/scripts/%2E%2E/%2E%2E/secret.txt`)).status).toBe(404);
        expect((await fetch(`${base}/v1/workbooks/${server.token}/w2/scripts/a.sql`)).status).toBe(404);
        expect((await fetch(`${base}/v1/workbooks/wrong/w1/scripts/a.sql`)).status).toBe(401);

        const newest = await fetch(`${base}/v1/results/${server.token}/${key}`);
        expect(newest.status).toBe(200);
        expect(await newest.text()).toBe('newer');
        expect(Number(newest.headers.get('X-DashQL-Cached-At'))).toBeGreaterThan(0);
        expect((await fetch(`${base}/v1/results/${server.token}/${'b'.repeat(64)}`)).status).toBe(404);
        expect((await fetch(`${base}/v1/results/${server.token}/not-a-key`)).status).toBe(404);
    });

    it('follows the conversation in a folder without a journal', async () => {
        server = await startSessionServer({ harness: 'claude', folder: path.join(temp('dashql-session-'), 'missing', '\0') });
        expect(server.state().workbooks).toEqual([]);
        expect(existsSync(path.join(server.state().folder, '.dashql'))).toBe(false);
    });
});
