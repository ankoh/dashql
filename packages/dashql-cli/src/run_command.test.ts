import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

import { runRun, type RunEnvironment } from './run_command.js';
import { runWith, testFiles } from './test_process.js';

const WORKBOOK_ID = '6f1c2a4e-8b3d-4c5e-9f70-1a2b3c4d5e6f';
const CONNECTION_ID = '0d9e8f7a-6b5c-4d3e-8f21-0a1b2c3d4e5f';

/// A Trino server that knows the table `orders` and the password `pw` of the user `ann`
class FakeTrino {
    readonly statements: string[] = [];
    readonly users: Array<string | undefined> = [];
    private server: Server | null = null;
    private next = 0;
    private readonly pending = new Map<string, string>();

    get endpoint(): string {
        return `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}`;
    }

    async start(): Promise<void> {
        this.server = createServer((request, response) => {
            void this.answer(request).then(([status, body]) => {
                response.writeHead(status, { 'content-type': 'application/json' });
                response.end(body == null ? '' : JSON.stringify(body));
            });
        });
        await new Promise<void>(resolve => this.server!.listen(0, '127.0.0.1', resolve));
    }

    async stop(): Promise<void> {
        await new Promise(resolve => this.server?.close(resolve));
    }

    private async answer(request: IncomingMessage): Promise<[number, object | null]> {
        if (request.headers.authorization !== `Basic ${btoa('ann:pw')}`) return [401, null];
        const url = new URL(request.url!, this.endpoint);
        if (request.method === 'POST' && url.pathname === '/v1/statement') {
            let text = '';
            for await (const chunk of request) text += chunk;
            this.statements.push(text);
            this.users.push(request.headers['x-trino-user'] as string | undefined);
            const id = `q${++this.next}`;
            this.pending.set(id, text);
            return [200, { id, nextUri: `${this.endpoint}/v1/statement/executing/${id}/1`, stats: { state: 'QUEUED' } }];
        }
        const executing = url.pathname.match(/^\/v1\/statement\/executing\/(q\d+)\/1$/);
        if (request.method === 'GET' && executing != null) {
            const id = executing[1];
            const text = this.pending.get(id) ?? '';
            if (/\bfail\b/.test(text)) {
                return [200, {
                    id, stats: { state: 'FAILED' },
                    error: { message: "line 1:8: Column 'fail' cannot be resolved", errorCode: 47, errorName: 'COLUMN_NOT_FOUND', errorType: 'USER_ERROR' },
                }];
            }
            if (/from orders/i.test(text)) {
                return [200, {
                    id, stats: { state: 'FINISHED' },
                    columns: [{ name: 'id', type: 'integer' }, { name: 'name', type: 'varchar' }],
                    data: [[1, 'apple'], [2, 'pear'], [3, null]],
                }];
            }
            return [200, { id, stats: { state: 'FINISHED' }, columns: [{ name: '_col0', type: 'integer' }], data: [[1]] }];
        }
        return [404, null];
    }
}

/// A workbook folder with scripts on one Trino connection
function trinoWorkbook(endpoint: string, scripts: Array<[string, string]>, username = 'ann'): string {
    const workbook = {
        formatVersion: 11,
        workbookId: WORKBOOK_ID,
        name: 'Orders',
        connections: [{
            connectionId: CONNECTION_ID,
            params: { trino: { endpoint, auth: { authType: 'AUTH_BASIC', basic: { username, secret: '' } } } },
        }],
        scripts: scripts.map(([name]) => ({ name, connectionId: CONNECTION_ID })),
        attachments: [],
        metadata: {},
    };
    return testFiles([
        ['dashql-workbook.json', JSON.stringify(workbook, null, 2)],
        ...scripts.map(([name, text]): [string, string] => [`scripts/${name}`, text]),
    ]);
}

const ORDERS: [string, string] = ['01_orders.sql', 'select id, name from orders\n'];
const BROKEN: [string, string] = ['02_broken.sql', 'select fail from orders\n'];
const PASSWORD: RunEnvironment = { trinoPassword: 'pw' };

const run = (dir: string, args: string[], env: RunEnvironment = PASSWORD) =>
    runWith((runArgs, cli) => runRun(runArgs, cli, env), dir, args);

describe('dashql run', () => {
    let trino: FakeTrino;

    beforeEach(async () => {
        trino = new FakeTrino();
        await trino.start();
    });
    afterEach(async () => {
        await trino.stop();
    });

    it('runs a script on Trino and prints the schema, the row count and the rows', async () => {
        const dir = trinoWorkbook(trino.endpoint, [ORDERS, BROKEN]);
        const output = await run(dir, ['.', 'scripts/01_orders.sql']);
        expect(output.stderr).toBe('');
        expect(output.code).toBe(0);
        expect(output.stdout).toMatch(/^01_orders\.sql {2}ok {2}3 rows {2}\d+\.\d s\n/);
        expect(output.stdout.split('\n').slice(1).join('\n')).toBe(`  id Int32, name Utf8
  id | name
  ---+------
  1  | apple
  2  | pear
  3  | NULL
`);
        // The health check, then the script; the user of the workbook with the password of the environment
        expect(trino.statements).toHaveLength(2);
        expect(trino.statements[1]).toContain('from orders');
        expect(trino.users).toEqual(['ann', 'ann']);
    });

    it('stops at the first script that fails and prints the error of Trino', async () => {
        const dir = trinoWorkbook(trino.endpoint, [BROKEN, ORDERS]);
        const output = await run(dir, [dir]);
        expect(output.code).toBe(1);
        expect(output.stdout).toBe(`02_broken.sql  failed
  line 1:8: Column 'fail' cannot be resolved

1 script not run
`);
    });

    it('limits the rows', async () => {
        const dir = trinoWorkbook(trino.endpoint, [ORDERS]);
        const output = await run(dir, ['--rows', '1', '.']);
        expect(output.code).toBe(0);
        expect(output.stdout.split('\n').slice(2).join('\n')).toBe(`  id | name
  ---+------
  1  | apple
  … 2 more
`);
    });

    it('fails before the scripts when the connection rejects the password', async () => {
        const dir = trinoWorkbook(trino.endpoint, [ORDERS]);
        const output = await run(dir, ['.'], { trinoPassword: 'wrong' });
        expect(output.code).toBe(1);
        expect(output.stdout).toBe(`trino ${trino.endpoint}  failed\n  Query failed (401 Unauthorized)\n`);
        expect(trino.statements).toEqual([]);
    });

    it('takes the user from the environment and never writes the password', async () => {
        const dir = trinoWorkbook(trino.endpoint, [ORDERS], 'someone');
        const output = await run(dir, ['.'], { trinoUser: 'ann', trinoPassword: 'pw' });
        expect(output.code).toBe(0);
        expect(readFileSync(path.join(dir, 'dashql-workbook.json'), 'utf8')).not.toContain('"pw"');
    });

    it('refuses unknown scripts, folders without a workbook and missing arguments', async () => {
        const dir = trinoWorkbook(trino.endpoint, [ORDERS]);
        const unknown = await run(dir, ['.', 'gone.sql']);
        expect(unknown.code).toBe(2);
        expect(unknown.stderr).toBe('error: the workbook has no script gone.sql, its scripts are 01_orders.sql\n');
        const empty = testFiles(['a.sql']);
        const noWorkbook = await run(empty, ['.']);
        expect(noWorkbook.code).toBe(2);
        expect(noWorkbook.stderr).toBe('error: . is no workbook folder, it has no dashql-workbook.json\n');
        expect((await run(dir, [])).code).toBe(2);
        expect(trino.statements).toEqual([]);
    });
});
