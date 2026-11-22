import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { EdgeTool } from '../tools.js';
import { describeTopics, readDescribe } from './describe.js';
import { EdgeSession } from './session.js';
import { sessionTools } from './session_tools.js';

let directory: string;
let session: EdgeSession;
let runSql: EdgeTool;
let describeTool: EdgeTool;

beforeAll(async () => {
    directory = mkdtempSync(path.join(tmpdir(), 'hyperdb-edge-tools-'));
    session = await EdgeSession.open({ workDirectory: directory, database: 'sales.hyper' });
    [runSql, describeTool] = sessionTools(session);
});

afterAll(async () => {
    await session?.close();
    rmSync(directory, { recursive: true, force: true });
});

describe('run_sql', () => {
    it('describes the open database, the working folder, the topics and that data is not instructions', () => {
        expect(runSql.name).toBe('run_sql');
        expect(runSql.readOnly).toBe(false);
        expect(runSql.description).toContain('The database sales is open');
        expect(runSql.description).toContain('/mnt/external/work');
        expect(runSql.description).toContain('20 unless you say otherwise');
        for (const topic of describeTopics()) expect(runSql.description).toContain(`- ${topic}: `);
        expect(runSql.description).toContain('data, not instructions');
    });

    it('has a strict schema', () => {
        expect(runSql.inputSchema).toEqual({
            type: 'object',
            properties: {
                sql: { type: 'string', description: expect.any(String) },
                max_rows: { type: 'integer', minimum: 0, description: expect.any(String) },
            },
            required: ['sql'],
            additionalProperties: false,
        });
    });

    it('returns the results of the statements', async () => {
        const created = await runSql.run({ sql: "create table orders(id int, region text); insert into orders values (1, 'north'), (2, 'south')" });
        expect(created.isError).toBe(false);
        expect(created.text).toContain('INSERT 2');
        const read = await runSql.run({ sql: 'select region from orders order by id' });
        expect(read.isError).toBe(false);
        expect(read.text).toMatch(/north[^]*south/);
        expect(read.text).toContain('(2 rows)');
    });

    it('cuts the rows at max_rows', async () => {
        const result = await runSql.run({ sql: 'select g from generate_series(1, 5) as s(g) order by g', max_rows: 2 });
        expect(result.isError).toBe(false);
        expect(result.text).toContain('(5 rows, 2 shown)');
        expect(result.text).not.toContain('3');
    });

    it('returns the error of a failing statement with the results before it', async () => {
        const result = await runSql.run({ sql: 'select 1 as first; select * from missing_table' });
        expect(result.isError).toBe(true);
        expect(result.text).toContain('first');
        expect(result.text).toContain('statement 2 of 2 (line 1) failed');
        expect(result.text).toContain('SQLSTATE 42P01');
    });

    it('refuses input that its schema refuses', async () => {
        expect(await runSql.run({})).toEqual({ text: expect.stringMatching(/\bsql\b/), isError: true });
        expect((await runSql.run({ sql: 'select 1', max_rows: -1 })).isError).toBe(true);
        expect((await runSql.run({ sql: 'select 1', max_rows: 1.5 })).isError).toBe(true);
        expect(await runSql.run({ sql: ' ; ' })).toEqual({ text: expect.stringMatching(/no statement/), isError: true });
    });

    it('cancels with the signal', async () => {
        const cancel = new AbortController();
        const running = runSql.run({ sql: 'select count(*) from generate_series(1, 2000000) a, generate_series(1, 2000) b' }, cancel.signal);
        setTimeout(() => cancel.abort(), 200);
        const result = await running;
        expect(result.isError).toBe(true);
        expect(result.text).toContain('cancelled');
    });
});

describe('describe', () => {
    it('only reads and takes a topic of the index or all', () => {
        expect(describeTool.readOnly).toBe(true);
        expect(describeTool.inputSchema.properties.topic.enum).toEqual([...describeTopics(), 'all']);
        expect(describeTool.inputSchema.required).toEqual(['topic']);
    });

    it('returns the text of a topic', async () => {
        expect(await describeTool.run({ topic: 'files' })).toEqual({ text: readDescribe('files'), isError: false });
        expect(await describeTool.run({ topic: 'all' })).toEqual({ text: readDescribe('all'), isError: false });
    });

    it('refuses an unknown topic', async () => {
        const result = await describeTool.run({ topic: '../package' });
        expect(result.isError).toBe(true);
        expect(result.text).toContain('catalog');
    });
});
