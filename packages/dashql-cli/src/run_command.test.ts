import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import * as arrow from 'apache-arrow';

import {
    followAgentSession,
    postAgentSessionRunEvent,
    writeAgentSessionResult,
    writeAgentSessionWorkbook,
    type AgentSessionRunMessage,
    type AgentSessionTarget,
} from '@akohn/dashql/platform/session/agent_session_client';
import { fetchAgentSession } from '@akohn/dashql/platform/session/agent_session_protocol';
import { encodeRunEvent, type RunEvent } from '@akohn/dashql/platform/workbook/run_events';

import { runRun, type RunEnvironment } from './run_command.js';
import { startSessionServer } from './session_server.js';
import { runWith, testFiles } from './test_process.js';

const WORKBOOK_ID = '6f1c2a4e-8b3d-4c5e-9f70-1a2b3c4d5e6f';
const CONNECTION_ID = '0d9e8f7a-6b5c-4d3e-8f21-0a1b2c3d4e5f';

/// A Trino server that knows the table `orders` and the password of the user `ann`
class FakeTrino {
    /// The password of `ann`
    password = 'pw';
    /// The access token of an OAuth login that the server takes as well, none by default
    bearer: string | null = null;
    /// The authorization headers of the requests
    readonly authorizations: Array<string | undefined> = [];
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
        this.authorizations.push(request.headers.authorization);
        const basic = request.headers.authorization === `Basic ${btoa(`ann:${this.password}`)}`;
        const bearer = this.bearer != null && request.headers.authorization === `Bearer ${this.bearer}`;
        if (!basic && !bearer) return [401, null];
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
        const executing = url.pathname.match(/^\/v1\/statement\/executing\/(q\d+)\/(\d)$/);
        if (request.method === 'GET' && executing != null) {
            const id = executing[1];
            const text = this.pending.get(id) ?? '';
            // A slow query reports its progress first and sends its rows after a while
            if (/\bslow\b/.test(text) && executing[2] === '1') {
                return [200, {
                    id, nextUri: `${this.endpoint}/v1/statement/executing/${id}/2`,
                    stats: { state: 'RUNNING', progressPercentage: 50, processedRows: 1000, elapsedTimeMillis: 10 },
                }];
            }
            if (executing[2] === '2') await new Promise(resolve => setTimeout(resolve, 1500));
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

/// A workbook folder with scripts on one Trino connection that logs in with OAuth
function oauthTrinoWorkbook(endpoint: string, scripts: Array<[string, string]>, idp = 'https://idp.example'): string {
    const dir = trinoWorkbook(endpoint, scripts);
    const file = path.join(dir, 'dashql-workbook.json');
    const workbook = JSON.parse(readFileSync(file, 'utf8'));
    workbook.connections[0].params.trino.auth = {
        authType: 'AUTH_OAUTH',
        oauth: { authorizationUrl: `${idp}/authorize`, tokenUrl: `${idp}/token`, clientId: 'dashql', scopes: ['openid'] },
    };
    writeFileSync(file, JSON.stringify(workbook, null, 2));
    return dir;
}

const HYPER_ID = '7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d';

/// Add scripts on the embedded Hyper to a workbook folder
function withHyperScripts(dir: string, scripts: Array<[string, string]>): void {
    const file = path.join(dir, 'dashql-workbook.json');
    const workbook = JSON.parse(readFileSync(file, 'utf8'));
    workbook.connections.push({ connectionId: HYPER_ID, params: { hyper: { protocol: 'WASM' } } });
    for (const [name, text] of scripts) {
        workbook.scripts.push({ name, connectionId: HYPER_ID });
        writeFileSync(path.join(dir, 'scripts', name), text);
    }
    writeFileSync(file, JSON.stringify(workbook, null, 2));
}

const ORDERS: [string, string] = ['01_orders.sql', 'select id, name from orders\n'];
const BROKEN: [string, string] = ['02_broken.sql', 'select fail from orders\n'];
const PASSWORD: Partial<RunEnvironment> = { trinoPassword: 'pw' };

/// A folder for the files of DashQL
const tempHome = () => mkdtempSync(path.join(process.env.TEST_TMPDIR ?? tmpdir(), 'dashql-home-'));

const run = (dir: string, args: string[], env: Partial<RunEnvironment> = PASSWORD, home: string | null = tempHome()) =>
    runWith((runArgs, cli) => runRun(runArgs, cli, { home, ...env }), dir, args);

/// The Parquet files of the query result cache of a home
const cacheFiles = (home: string) => readdirSync(path.join(home, 'cache')).filter(file => file.endsWith('.parquet'));

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
        const home = tempHome();
        const output = await run(dir, ['.', 'scripts/01_orders.sql'], PASSWORD, home);
        expect(output.stderr).toBe('');
        expect(output.code).toBe(0);
        expect(output.stdout).toMatch(/^01_orders\.sql {2}ok {2}3 rows {2}\d+\.\d s\n/);
        const [cached] = cacheFiles(home);
        expect(output.stdout.split('\n').slice(1).join('\n')).toBe(`  id Int32, name Utf8
  id | name
  ---+------
  1  | apple
  2  | pear
  3  | NULL
  ${path.join(home, 'cache', cached)}

1 ok
`);
        // The instance of the embedded Hyper is gone, the cache stays
        expect(readdirSync(path.join(home, 'instances'))).toEqual([]);
        // The health check, then the script; the user of the workbook with the password of the environment
        expect(trino.statements).toHaveLength(2);
        expect(trino.statements[1]).toContain('from orders');
        expect(trino.users).toEqual(['ann', 'ann']);
    });

    it('stops at the first script that fails and prints the error of Trino at its statement', async () => {
        const dir = trinoWorkbook(trino.endpoint, [BROKEN, ORDERS]);
        const output = await run(dir, [dir]);
        expect(output.code).toBe(1);
        expect(output.stdout.replace(/failed {2}\d+\.\d s/, 'failed  0.1 s')).toBe(`02_broken.sql  failed  0.1 s
  line 1:8: Column 'fail' cannot be resolved
  │ select fail from orders
  │        ^^^^
01_orders.sql  not run  the run stopped

1 failed, 1 not run
`);
    });

    it('limits the rows', async () => {
        const dir = trinoWorkbook(trino.endpoint, [ORDERS]);
        const output = await run(dir, ['--rows', '1', '.']);
        expect(output.code).toBe(0);
        expect(output.stdout.split('\n').slice(2, 6).join('\n')).toBe(`  id | name
  ---+------
  1  | apple
  … 2 more`);
    });

    it('serves a cached result unless a refresh runs the script again', async () => {
        const dir = trinoWorkbook(trino.endpoint, [ORDERS]);
        const home = tempHome();
        expect((await run(dir, ['.'], PASSWORD, home)).code).toBe(0);
        const [first] = cacheFiles(home);
        expect(trino.statements.filter(text => text.includes('orders'))).toHaveLength(1);

        // The cache serves the result, the run doesn't reach Trino at all, not even to check the connection
        const before = trino.statements.length;
        const again = await run(dir, ['.'], { trinoPassword: 'wrong' }, home);
        expect(again.code).toBe(0);
        expect(again.stdout).toMatch(/^01_orders\.sql {2}ok {2}3 rows {2}\d+\.\d s {2}from the cache\n/);
        expect(again.stdout).toContain(path.join(home, 'cache', first));
        expect(trino.statements).toHaveLength(before);

        const refreshed = await run(dir, ['--refresh', '.'], PASSWORD, home);
        expect(refreshed.code).toBe(0);
        expect(refreshed.stdout).not.toContain('from the cache');
        expect(trino.statements.filter(text => text.includes('orders'))).toHaveLength(2);
        // The newer file of the key replaced the older one
        expect(cacheFiles(home)).toHaveLength(1);
        expect(cacheFiles(home)).not.toEqual([first]);
    });

    it('scans the result of a script on Trino from a script on the embedded Hyper', async () => {
        // A reference names a script by an identifier
        const dir = trinoWorkbook(trino.endpoint, [['orders.sql', ORDERS[1]]]);
        withHyperScripts(dir, [['02_count.sql', 'select count(*) as n, count(name) as named from :orders\n']]);
        const home = tempHome();
        const output = await run(dir, ['.', '02_count.sql'], PASSWORD, home);
        expect(output.stderr).toBe('');
        expect(output.stdout).toMatch(/^02_count\.sql {2}ok {2}1 row {2}\d+\.\d s\n {2}n Int64, named Int64\n {2}n \| named\n {2}--\+------\n {2}3 \| 2\n/);
        expect(output.code).toBe(0);
        // The result of the Trino script was materialized into the cache and scanned
        expect(trino.statements.filter(text => text.includes('orders'))).toHaveLength(1);
        expect(cacheFiles(home).length).toBeGreaterThanOrEqual(1);
    });

    it('reads the attachments of the workbook folder from the embedded Hyper', async () => {
        const dir = trinoWorkbook(trino.endpoint, [ORDERS]);
        const home = tempHome();
        expect((await run(dir, ['.'], PASSWORD, home)).code).toBe(0);
        // A Parquet file as attachment, the cached result of the Trino script
        mkdirSync(path.join(dir, 'attachments'));
        copyFileSync(path.join(home, 'cache', cacheFiles(home)[0]), path.join(dir, 'attachments', 'fruits.parquet'));
        withHyperScripts(dir, [['02_fruits.sql', "select name from :fruits where id = 2\n"]]);
        const output = await run(dir, ['.', '02_fruits.sql'], PASSWORD, home);
        expect(output.stderr).toBe('');
        expect(output.code).toBe(0);
        expect(output.stdout).toContain('  pear\n');
        expect(readdirSync(path.join(home, 'workbooks', WORKBOOK_ID, 'attachments'))).toEqual(['fruits.parquet']);
    });

    it('appends the files of the folder and the log of the run to the journal of a session', async () => {
        const dir = trinoWorkbook(trino.endpoint, [ORDERS, BROKEN]);
        // `dashql session serve` creates the journal in the folder of its session
        mkdirSync(path.join(dir, '.dashql'));
        writeFileSync(path.join(dir, '.dashql', 'journal.jsonl'), '');
        // Without DASHQL_HOME the files of DashQL go into the .dashql/ of the session
        expect((await run(dir, ['.'], PASSWORD, null)).code).toBe(1);
        const home = path.join(dir, '.dashql');
        expect(readdirSync(home).sort()).toEqual(['cache', 'instances', 'journal.jsonl', 'logs', 'workbooks']);
        const records = readFileSync(path.join(dir, '.dashql', 'journal.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
        // The log of the run, at info and above, with the markers of what changed
        expect(records.every(record => record.level >= 3)).toBe(true);
        expect(records.some(record => record.target !== 'workbook_journal')).toBe(true);
        const markers = records.filter(record => record.target === 'workbook_journal');
        expect(markers.map(record => record.message)).toEqual(['Workbook files']);
        expect(markers[0].keyValues).toMatchObject({ workbook: '.', workbook_id: WORKBOOK_ID, files: ['dashql-workbook.json', 'scripts/01_orders.sql', 'scripts/02_broken.sql'] });
    });

    it('finds the session in the workspace that it is given, not above the invoking directory', async () => {
        const workspace = testFiles([['.dashql/journal.jsonl', '']]);
        const dir = trinoWorkbook(trino.endpoint, [ORDERS]);
        const nested = path.join(workspace, 'orders');
        copyFileSync(path.join(dir, 'dashql-workbook.json'), (mkdirSync(path.join(nested, 'scripts'), { recursive: true }), path.join(nested, 'dashql-workbook.json')));
        copyFileSync(path.join(dir, 'scripts', ORDERS[0]), path.join(nested, 'scripts', ORDERS[0]));
        const journal = () => readFileSync(path.join(workspace, '.dashql', 'journal.jsonl'), 'utf8');

        // Invoked in the workbook folder, the session one level up is not searched for
        expect((await run(nested, ['.'])).code).toBe(0);
        expect(journal()).toBe('');

        // Given the workspace, the run names its workbook folder relative to it
        expect((await run(nested, ['--workspace', '..', '.'], PASSWORD, null)).code).toBe(0);
        const markers = journal().trim().split('\n').map(line => JSON.parse(line)).filter(record => record.target === 'workbook_journal');
        expect(markers[0].keyValues).toMatchObject({ workbook: 'orders', files: ['dashql-workbook.json', 'scripts/01_orders.sql'] });
        expect(existsSync(path.join(workspace, '.dashql', 'cache'))).toBe(true);
    });

    it('appends to the journal of the session of dashql connect that it runs in', async () => {
        const dir = trinoWorkbook(trino.endpoint, [ORDERS]);
        // The sessions of two connects in the folder and the one of session serve
        for (const journal of ['journal.jsonl', 'sessions/51001/journal.jsonl', 'sessions/51002/journal.jsonl']) {
            mkdirSync(path.dirname(path.join(dir, '.dashql', journal)), { recursive: true });
            writeFileSync(path.join(dir, '.dashql', journal), '');
        }
        expect((await run(dir, ['.'], { ...PASSWORD, session: '51002' })).code).toBe(0);
        const lines = (journal: string) => readFileSync(path.join(dir, '.dashql', journal), 'utf8');
        expect(lines('sessions/51002/journal.jsonl')).toContain('"workbook_journal"');
        expect(lines('sessions/51001/journal.jsonl')).toBe('');
        expect(lines('journal.jsonl')).toBe('');
    });

    it('runs only on the connections that the tab of the session lets the agent use', async () => {
        const dir = trinoWorkbook(trino.endpoint, [ORDERS]);
        withHyperScripts(dir, [['02_one.sql', 'select 1 as one\n']]);
        mkdirSync(path.join(dir, '.dashql', 'sessions', '51003'), { recursive: true });
        writeFileSync(path.join(dir, '.dashql', 'sessions', '51003', 'connections.json'), JSON.stringify({ connections: [{ connectionId: HYPER_ID, name: 'Hyper' }] }));
        const output = await run(dir, ['.'], { ...PASSWORD, session: '51003' });
        expect(output.code).toBe(1);
        expect(output.stdout).toContain(`trino ${trino.endpoint}  failed\n  the tab of DashQL does not let the agent use this connection, the user can allow it in the prompt\n`);
        expect(output.stdout).toMatch(/^02_one\.sql {2}ok {2}1 row /m);
        expect(output.stdout).toContain('01_orders.sql  not run  its connection could not be set up\n');
        expect(trino.statements).toEqual([]);
        // Another session, or none, lets the agent use every connection
        expect((await run(dir, ['.'], { ...PASSWORD, session: '51004' })).code).toBe(0);
    });

    it('reaches a connection with OAuth only in the tab of a session', async () => {
        const dir = oauthTrinoWorkbook(trino.endpoint, [ORDERS]);
        const output = await run(dir, ['.'], {});
        expect(output.code).toBe(1);
        expect(output.stdout).toContain('the connection signs in with OAuth, dashql run reaches it only in the tab of a session of dashql connect');
        expect(trino.statements).toEqual([]);
    });

    it('leaves out the scripts of a connection that rejects the password', async () => {
        const dir = trinoWorkbook(trino.endpoint, [ORDERS]);
        const output = await run(dir, ['.'], { trinoPassword: 'wrong' });
        expect(output.code).toBe(1);
        expect(output.stdout).toBe(`trino ${trino.endpoint}  failed
  Query failed (401 Unauthorized)
01_orders.sql  not run  its connection could not be set up

1 not run
`);
        expect(trino.statements).toEqual([]);
    });

    it('runs the scripts of the other connections when a connection fails', async () => {
        const dir = trinoWorkbook(trino.endpoint, [ORDERS]);
        withHyperScripts(dir, [['02_one.sql', 'select 1 as one\n']]);
        const output = await run(dir, ['.'], { trinoPassword: 'wrong' });
        expect(output.code).toBe(1);
        expect(output.stdout).toContain(`trino ${trino.endpoint}  failed\n`);
        expect(output.stdout).toMatch(/^02_one\.sql {2}ok {2}1 row /m);
        expect(output.stdout).toContain('01_orders.sql  not run  its connection could not be set up\n');
        expect(output.stdout).toMatch(/\n1 ok, 1 not run\n$/);
    });

    it('runs the scripts of different connections at the same time', async () => {
        const dir = trinoWorkbook(trino.endpoint, [['01_slow.sql', "select id, name from orders where 'slow' = 'slow'\n"]]);
        withHyperScripts(dir, [['02_one.sql', 'select 1 as one\n']]);
        const output = await run(dir, ['.']);
        expect(output.stderr).toBe('');
        expect(output.code).toBe(0);
        // The script on the embedded Hyper is done while the slow one runs on Trino
        const order = output.stdout.split('\n').filter(line => /^\S+\.sql {2}/.test(line)).map(line => line.split(' ')[0]);
        expect(order).toEqual(['02_one.sql', '01_slow.sql']);
        expect(output.stdout).toMatch(/\n2 ok\n$/);
    });

    it('takes the user from the environment and never writes the password', async () => {
        const dir = trinoWorkbook(trino.endpoint, [ORDERS], 'someone');
        // A session in the folder, its journal gets the log of the run
        mkdirSync(path.join(dir, '.dashql'));
        writeFileSync(path.join(dir, '.dashql', 'journal.jsonl'), '');
        const secret = 'pw-0a1b2c3d';
        trino.password = secret;
        const output = await run(dir, ['.'], { trinoUser: 'ann', trinoPassword: secret }, null);
        expect(output.code).toBe(0);
        // Neither the workbook nor anything of the session holds it
        const files = [path.join(dir, 'dashql-workbook.json'), ...readdirSync(path.join(dir, '.dashql'), { recursive: true, withFileTypes: true })
            .filter(entry => entry.isFile()).map(entry => path.join(entry.parentPath, entry.name))];
        for (const file of files) expect(readFileSync(file).toString('latin1')).not.toContain(secret);
    });

    it('stops when interrupted, cancels the running query and removes its instance', async () => {
        const dir = trinoWorkbook(trino.endpoint, [['slow.sql', "select id, name from orders where 'slow' = 'slow'\n"], ORDERS]);
        const home = tempHome();
        // Interrupted while the slow query runs on Trino
        const interrupt = new AbortController();
        const watch = setInterval(() => { if (trino.statements.some(text => text.includes("'slow'"))) interrupt.abort(); }, 20);
        const output = await runWith((runArgs, cli) => runRun(runArgs, { ...cli, interrupt: interrupt.signal }, { home, ...PASSWORD }), dir, ['.']);
        clearInterval(watch);
        expect(output.code).toBe(130);
        expect(output.stderr).toBe('interrupted\n');
        expect(output.stdout).toBe('slow.sql  cancelled\n01_orders.sql  not run  interrupted\n\n1 cancelled, 1 not run\n');
        expect(trino.statements.filter(text => text.includes('orders'))).toHaveLength(1);
        expect(readdirSync(path.join(home, 'instances'), { withFileTypes: true }).filter(entry => entry.isDirectory())).toEqual([]);
    });

    it('refuses unknown scripts, folders without a workbook and missing arguments', async () => {
        const dir = trinoWorkbook(trino.endpoint, [ORDERS]);
        const unknown = await run(dir, ['.', 'gone.sql']);
        expect(unknown.code).toBe(2);
        expect(unknown.stderr).toBe('error: the workbook has no script gone.sql, its scripts are 01_orders.sql\n');
        expect(existsSync(dir)).toBe(true);
        const empty = testFiles(['a.sql']);
        const noWorkbook = await run(empty, ['.']);
        expect(noWorkbook.code).toBe(2);
        expect(noWorkbook.stderr).toBe('error: . is no workbook folder, it has no dashql-workbook.json\n');
        expect((await run(dir, [])).code).toBe(2);
        expect(trino.statements).toEqual([]);
    });
});

describe('dashql run in a session of dashql connect', () => {
    const SESSION = '51020';
    const COPY = `.dashql/workbooks/${WORKBOOK_ID}`;

    /// A session with a tab that follows it: the tab copied the workbook and answers its runs
    async function sessionWithTab(answer: (message: Extract<AgentSessionRunMessage, { type: 'run' }>, send: (event: RunEvent) => Promise<void>, stopped: Promise<void>, target: AgentSessionTarget) => Promise<void>) {
        const folder = testFiles([]);
        const server = await startSessionServer({ harness: 'claude', folder, session: SESSION });
        const target = { endpoint: `http://127.0.0.1:${server.port}`, token: server.token };
        const tab = new AbortController();
        const runs: Array<Extract<AgentSessionRunMessage, { type: 'run' }>> = [];
        const stops = new Map<string, () => void>();
        let followed: () => void = () => { };
        const following = new Promise<void>(resolve => { followed = resolve; });
        void followAgentSession(target, () => followed(), tab.signal, message => {
            if (message.type === 'stop') return stops.get(message.runId)?.();
            runs.push(message);
            const stopped = new Promise<void>(resolve => stops.set(message.runId, resolve));
            void answer(message, async event => { await postAgentSessionRunEvent(target, message.runId, encodeRunEvent(event, message.rows)); }, stopped, target);
        }).catch(() => { });
        await following;
        const workbook = trinoWorkbook('http://trino.invalid', [ORDERS]);
        await writeAgentSessionWorkbook(target, WORKBOOK_ID, ['dashql-workbook.json', `scripts/${ORDERS[0]}`].map(file => ({ path: file, content: readFileSync(path.join(workbook, file), 'utf8') })));
        const env: Partial<RunEnvironment> = { session: SESSION, sessionEndpoint: target.endpoint, sessionToken: target.token };
        return {
            folder, env, runs, target,
            close: async () => {
                tab.abort();
                await server.close();
            },
        };
    }

    it('runs a workbook that the tab copied in the tab and prints its events', async () => {
        const rows = arrow.tableFromArrays({ id: Int32Array.from({ length: 12 }, (_, i) => i + 1) });
        const key = 'c'.repeat(64);
        const session = await sessionWithTab(async (message, send, _stopped, target) => {
            await send({ type: 'run_started', workbook: message.label, scripts: [ORDERS[0]] });
            await send({ type: 'script_started', script: ORDERS[0] });
            // The file of the result goes into the cache of the session first
            const file = await writeAgentSessionResult(target, key, new Blob(['PAR1 the result PAR1']));
            await send({ type: 'script_done', script: ORDERS[0], ms: 1200, rows: rows.numRows, table: rows, cached: false, key, file });
            await send({ type: 'run_finished', ms: 1300, ok: 1, failed: 0, cancelled: 0, notRun: 0, interrupted: false });
        });
        try {
            const output = await runWith((args, cli) => runRun(args, cli, { home: tempHome(), ...session.env }), session.folder, ['--rows', '2', COPY]);
            expect(output.stderr).toBe('');
            expect(output.code).toBe(0);
            // The table of the result came with its first rows, the count with all of them, the file is in the cache of
            // the session
            const [cached] = readdirSync(path.join(session.folder, '.dashql', 'cache'));
            expect(cached).toMatch(new RegExp(`^${key}\\.[0-9a-f-]{36}\\.parquet$`));
            expect(readFileSync(path.join(session.folder, '.dashql', 'cache', cached), 'utf8')).toBe('PAR1 the result PAR1');
            expect(output.stdout).toBe(`${ORDERS[0]}  ok  12 rows  1.2 s\n  id Int32\n  id\n  --\n  1\n  2\n  … 10 more\n  .dashql/cache/${cached}\n\n1 ok\n`);
            // Only files of keys
            const url = `${session.target.endpoint}/v1/results/${session.target.token}`;
            expect((await fetchAgentSession(`${url}/not-a-key`, { method: 'PUT', body: 'x' })).status).toBe(400);
            expect(session.runs).toEqual([{ type: 'run', runId: expect.any(String), workbookId: WORKBOOK_ID, label: COPY, scripts: [], refresh: false, rows: 2 }]);
        } finally {
            await session.close();
        }
    });

    it('stops the run in the tab on an interrupt', async () => {
        const session = await sessionWithTab(async (_message, send, stopped) => {
            await send({ type: 'run_started', workbook: COPY, scripts: [ORDERS[0]] });
            await send({ type: 'script_started', script: ORDERS[0] });
            await stopped;
            await send({ type: 'script_cancelled', script: ORDERS[0], ms: 10 });
            await send({ type: 'run_finished', ms: 20, ok: 0, failed: 0, cancelled: 1, notRun: 0, interrupted: true });
        });
        try {
            const interrupt = new AbortController();
            const running = runWith((args, cli) => runRun(args, { ...cli, interrupt: interrupt.signal }, { home: tempHome(), ...session.env }), session.folder, [COPY]);
            await vi.waitFor(() => expect(session.runs).toHaveLength(1));
            interrupt.abort();
            const output = await running;
            expect(output.code).toBe(130);
            expect(output.stderr).toBe('interrupted\n');
            expect(output.stdout).toBe(`${ORDERS[0]}  cancelled\n\n1 cancelled\n`);
        } finally {
            await session.close();
        }
    });

    it('fails without a tab that follows the session, a folder of its own runs here', async () => {
        const folder = testFiles([]);
        const server = await startSessionServer({ harness: 'claude', folder, session: SESSION });
        try {
            const env: Partial<RunEnvironment> = { session: SESSION, sessionEndpoint: `http://127.0.0.1:${server.port}`, sessionToken: server.token };
            const copy = path.join(folder, ...COPY.split('/'));
            const workbook = trinoWorkbook('http://trino.invalid', [ORDERS]);
            mkdirSync(path.join(copy, 'scripts'), { recursive: true });
            for (const file of ['dashql-workbook.json', `scripts/${ORDERS[0]}`]) copyFileSync(path.join(workbook, file), path.join(copy, file));
            const output = await runWith((args, cli) => runRun(args, cli, { home: tempHome(), ...env }), folder, [COPY]);
            expect(output.code).toBe(1);
            expect(output.stderr).toBe('error: no tab of DashQL follows the session, open it with the line of dashql connect\n');
            // A workbook folder that no tab copied runs in this process
            const own = await runWith((args, cli) => runRun(args, cli, { home: tempHome(), ...env }), workbook, ['.']);
            expect(own.stdout).toContain(`trino http://trino.invalid  failed`);
        } finally {
            await server.close();
        }
    });
});
