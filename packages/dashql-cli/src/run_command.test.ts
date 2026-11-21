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
import { initWorkspace } from './session_folder.js';
import { startSessionServer } from './session_server.js';
import { runWith, testFiles } from './test_process.js';

/// What a command says to a folder that is no workspace, after its name
const NO_WORKSPACE = 'is no workspace of DashQL, it has no dashql-workspace.json. Pass the workspace that the start of the session of dashql connect names. Only the user sets up a workspace.';

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

/// A workspace of its own, as dashql init sets it up
const tempWorkspace = () => {
    const workspace = mkdtempSync(path.join(process.env.TEST_TMPDIR ?? tmpdir(), 'dashql-workspace-'));
    initWorkspace(workspace);
    return workspace;
};

/// A run in the workbook folder with a workspace of its own, null for the .dashql/ of the folder
const run = (dir: string, args: string[], env: RunEnvironment = PASSWORD, workspace: string | null = tempWorkspace()) =>
    runWith((runArgs, cli) => {
        if (workspace == null) initWorkspace(path.join(dir, '.dashql'));
        return runRun([...(workspace == null ? [] : ['-w', workspace]), ...runArgs], cli, env);
    }, dir, args);

/// The results folder of the workbook in a workspace
const resultsFolder = (workspace: string) => path.join(workspace, 'workbooks', WORKBOOK_ID, 'results');
/// The stored results of the workbook in a workspace, one file per script
const cacheFiles = (workspace: string) => readdirSync(resultsFolder(workspace)).filter(file => file.endsWith('.parquet'));

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
        const workspace = tempWorkspace();
        const output = await run(dir, ['.', 'scripts/01_orders.sql'], PASSWORD, workspace);
        expect(output.stderr).toBe('');
        expect(output.code).toBe(0);
        expect(output.stdout).toMatch(/^01_orders\.sql {2}ok {2}3 rows {2}\d+\.\d s\n/);
        const [cached] = cacheFiles(workspace);
        expect(output.stdout.split('\n').slice(1).join('\n')).toBe(`  id Int32, name Utf8
  id | name
  ---+------
  1  | apple
  2  | pear
  3  | NULL
  ${path.join(resultsFolder(workspace), cached)}

1 ok
`);
        // The file of the script is named after it
        expect(cached).toMatch(/^01_orders\.[0-9a-f]{64}\.[0-9a-f]{20}\.parquet$/);
        // The instance of the embedded Hyper is gone, the results stay
        expect(readdirSync(path.join(workspace, 'instances'))).toEqual([]);
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

    it('reuses a stored result unless a refresh runs the script again', async () => {
        const dir = trinoWorkbook(trino.endpoint, [ORDERS]);
        const workspace = tempWorkspace();
        expect((await run(dir, ['.'], PASSWORD, workspace)).code).toBe(0);
        const [first] = cacheFiles(workspace);
        expect(trino.statements.filter(text => text.includes('orders'))).toHaveLength(1);

        // The stored result is reused, the run doesn't reach Trino at all, not even to check the connection
        const before = trino.statements.length;
        const again = await run(dir, ['.'], { trinoPassword: 'wrong' }, workspace);
        expect(again.code).toBe(0);
        expect(again.stdout).toMatch(/^01_orders\.sql {2}ok {2}3 rows {2}\d+\.\d s {2}reused\n/);
        expect(again.stdout).toContain(path.join(resultsFolder(workspace), first));
        expect(trino.statements).toHaveLength(before);

        const refreshed = await run(dir, ['--refresh', '.'], PASSWORD, workspace);
        expect(refreshed.code).toBe(0);
        expect(refreshed.stdout).not.toContain('reused');
        expect(trino.statements.filter(text => text.includes('orders'))).toHaveLength(2);
        // The newer file of the script replaced the older one
        expect(cacheFiles(workspace)).toHaveLength(1);
        expect(cacheFiles(workspace)).not.toEqual([first]);
    });

    it('scans the result of a script on Trino from a script on the embedded Hyper', async () => {
        // A reference names a script by an identifier
        const dir = trinoWorkbook(trino.endpoint, [['orders.sql', ORDERS[1]]]);
        withHyperScripts(dir, [['02_count.sql', 'select count(*) as n, count(name) as named from :orders\n']]);
        const workspace = tempWorkspace();
        const output = await run(dir, ['.', '02_count.sql'], PASSWORD, workspace);
        expect(output.stderr).toBe('');
        expect(output.stdout).toMatch(/^02_count\.sql {2}ok {2}1 row {2}\d+\.\d s\n {2}n Int64, named Int64\n {2}n \| named\n {2}--\+------\n {2}3 \| 2\n/);
        expect(output.code).toBe(0);
        // The result of the Trino script was materialized into its file and scanned
        expect(trino.statements.filter(text => text.includes('orders'))).toHaveLength(1);
        expect(cacheFiles(workspace).length).toBeGreaterThanOrEqual(1);
    });

    it('reads the attachments of the workbook folder from the embedded Hyper', async () => {
        const dir = trinoWorkbook(trino.endpoint, [ORDERS]);
        const workspace = tempWorkspace();
        expect((await run(dir, ['.'], PASSWORD, workspace)).code).toBe(0);
        // A Parquet file as attachment, the stored result of the Trino script
        mkdirSync(path.join(dir, 'attachments'));
        copyFileSync(path.join(resultsFolder(workspace), cacheFiles(workspace)[0]), path.join(dir, 'attachments', 'fruits.parquet'));
        withHyperScripts(dir, [['02_fruits.sql', "select name from :fruits where id = 2\n"]]);
        const output = await run(dir, ['.', '02_fruits.sql'], PASSWORD, workspace);
        expect(output.stderr).toBe('');
        expect(output.code).toBe(0);
        expect(output.stdout).toContain('  pear\n');
        expect(readdirSync(path.join(workspace, 'workbooks', WORKBOOK_ID, 'attachments'))).toEqual(['fruits.parquet']);
    });

    it('keeps its files in the .dashql/ of the invoking directory by default', async () => {
        const dir = trinoWorkbook(trino.endpoint, [ORDERS, BROKEN]);
        // Without --workspace the files of DashQL go into the .dashql/ of the invoking directory, which ignores itself
        expect((await run(dir, ['.'], PASSWORD, null)).code).toBe(1);
        expect(readdirSync(path.join(dir, '.dashql')).sort()).toEqual(['.gitignore', 'dashql-workspace.json', 'instances', 'logs', 'workbooks']);
        expect(readFileSync(path.join(dir, '.dashql', '.gitignore'), 'utf8')).toBe('*\n');
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
        // The files of DashQL in the folder, with the logs of the run
        const secret = 'pw-0a1b2c3d';
        trino.password = secret;
        const output = await run(dir, ['.'], { trinoUser: 'ann', trinoPassword: secret }, null);
        expect(output.code).toBe(0);
        // Neither the workbook nor the files of DashQL hold it
        const files = [path.join(dir, 'dashql-workbook.json'), ...readdirSync(path.join(dir, '.dashql'), { recursive: true, withFileTypes: true })
            .filter(entry => entry.isFile()).map(entry => path.join(entry.parentPath, entry.name))];
        for (const file of files) expect(readFileSync(file).toString('latin1')).not.toContain(secret);
    });

    it('stops when interrupted, cancels the running query and removes its instance', async () => {
        const dir = trinoWorkbook(trino.endpoint, [['slow.sql', "select id, name from orders where 'slow' = 'slow'\n"], ORDERS]);
        const workspace = tempWorkspace();
        // Interrupted while the slow query runs on Trino
        const interrupt = new AbortController();
        const watch = setInterval(() => { if (trino.statements.some(text => text.includes("'slow'"))) interrupt.abort(); }, 20);
        const output = await runWith((runArgs, cli) => runRun(runArgs, { ...cli, interrupt: interrupt.signal }, PASSWORD), dir, ['--workspace', workspace, '.']);
        clearInterval(watch);
        expect(output.code).toBe(130);
        expect(output.stderr).toBe('interrupted\n');
        expect(output.stdout).toBe('slow.sql  cancelled\n01_orders.sql  not run  interrupted\n\n1 cancelled, 1 not run\n');
        expect(trino.statements.filter(text => text.includes('orders'))).toHaveLength(1);
        expect(readdirSync(path.join(workspace, 'instances'), { withFileTypes: true }).filter(entry => entry.isDirectory())).toEqual([]);
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
    const SESSION = '0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0';
    const COPY = `.dashql/workbooks/${WORKBOOK_ID}`;
    /// The workspace of a session in a folder, its .dashql/
    const ws = (folder: string) => path.join(folder, '.dashql');

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
        return {
            folder, runs, target,
            close: async () => {
                tab.abort();
                await server.close();
            },
        };
    }

    it('runs a workbook that the tab copied in the tab and prints its events', async () => {
        const rows = arrow.tableFromArrays({ id: Int32Array.from({ length: 12 }, (_, i) => i + 1) });
        const key = 'c'.repeat(64);
        const name = `${ORDERS[0]}.${key}.0000000a.parquet`;
        const session = await sessionWithTab(async (message, send, _stopped, target) => {
            await send({ type: 'run_started', workbook: message.label, scripts: [ORDERS[0]] });
            await send({ type: 'script_started', script: ORDERS[0] });
            // The file of the result goes into the results of the workbook in the session first
            const file = await writeAgentSessionResult(target, message.workbookId, name, new Blob(['PAR1 the result PAR1']));
            await send({ type: 'script_done', script: ORDERS[0], ms: 1200, rows: rows.numRows, table: rows, cached: false, key, file });
            await send({ type: 'run_finished', ms: 1300, ok: 1, failed: 0, cancelled: 0, notRun: 0, interrupted: false });
        });
        try {
            const output = await runWith((args, cli) => runRun(args, cli), session.folder, ['--workspace', ws(session.folder), '--rows', '2', COPY]);
            expect(output.stderr).toBe('');
            expect(output.code).toBe(0);
            // The table of the result came with its first rows, the count with all of them, the file is in the results
            // of the workbook in the session
            const results = path.join(session.folder, '.dashql', 'workbooks', WORKBOOK_ID, 'results');
            expect(readdirSync(results)).toEqual([name]);
            expect(readFileSync(path.join(results, name), 'utf8')).toBe('PAR1 the result PAR1');
            expect(output.stdout).toBe(`${ORDERS[0]}  ok  12 rows  1.2 s\n  id Int32\n  id\n  --\n  1\n  2\n  … 10 more\n  .dashql/workbooks/${WORKBOOK_ID}/results/${name}\n\n1 ok\n`);
            // Only Parquet files of the workbooks
            const url = `${session.target.endpoint}/v1/results/${session.target.token}`;
            expect((await fetchAgentSession(`${url}/not-a-workbook/${name}`, { method: 'PUT', body: 'x' })).status).toBe(400);
            expect((await fetchAgentSession(`${url}/${WORKBOOK_ID}/notes.txt`, { method: 'PUT', body: 'x' })).status).toBe(400);
            expect((await fetchAgentSession(`${url}/${WORKBOOK_ID}/..%2F${name}`, { method: 'PUT', body: 'x' })).status).toBe(400);
            expect(session.runs).toEqual([{ type: 'run', runId: expect.any(String), workbookId: WORKBOOK_ID, label: COPY, scripts: [], refresh: false, rows: 2 }]);
        } finally {
            await session.close();
        }
    });

    it('runs the copy in the tab from a shell in the copy, in the session of the workspace', async () => {
        const session = await sessionWithTab(async (message, send) => {
            await send({ type: 'run_started', workbook: message.label, scripts: [ORDERS[0]] });
            await send({ type: 'run_finished', ms: 1, ok: 0, failed: 0, cancelled: 0, notRun: 0, interrupted: false });
        });
        try {
            const copy = path.join(session.folder, ...COPY.split('/'));
            const output = await runWith((args, cli) => runRun(args, cli), copy, ['--workspace', ws(session.folder), '.']);
            expect(output.stderr).toBe('');
            expect(output.code).toBe(0);
            expect(session.runs).toEqual([{ type: 'run', runId: expect.any(String), workbookId: WORKBOOK_ID, label: '.', scripts: [], refresh: false, rows: 10 }]);
            // The .dashql/ of the invoking directory is the workspace by default: the copy has none, the run fails
            // instead of running outside the tab
            const bare = await runWith((args, cli) => runRun(args, cli), copy, ['.']);
            expect(bare.code).toBe(2);
            expect(bare.stderr).toBe(`error: .dashql ${NO_WORKSPACE}\n`);
            // Nor is the folder around the workspace one
            const around = await runWith((args, cli) => runRun(args, cli), copy, ['--workspace', '../../..', '.']);
            expect(around.code).toBe(2);
            expect(around.stderr).toBe(`error: ../../.. ${NO_WORKSPACE}\n`);
            // A relative workspace works like an absolute one, and the .dashql/ of the folder of the session is the
            // workspace by default
            const relative = await runWith((args, cli) => runRun(args, cli), copy, ['--workspace', '../..', '.']);
            expect(relative.stderr).toBe('');
            expect(relative.code).toBe(0);
            const here = await runWith((args, cli) => runRun(args, cli), session.folder, [COPY]);
            expect(here.stderr).toBe('');
            expect(here.code).toBe(0);
            expect(session.runs).toHaveLength(3);
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
            const running = runWith((args, cli) => runRun(args, { ...cli, interrupt: interrupt.signal }), session.folder, ['--workspace', ws(session.folder), COPY]);
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

    it('fails without a tab that follows the session, and runs no other folder while a session runs', async () => {
        const folder = testFiles([]);
        const server = await startSessionServer({ harness: 'claude', folder, session: SESSION });
        try {
            const copy = path.join(folder, ...COPY.split('/'));
            const workbook = trinoWorkbook('http://trino.invalid', [ORDERS]);
            mkdirSync(path.join(copy, 'scripts'), { recursive: true });
            for (const file of ['dashql-workbook.json', `scripts/${ORDERS[0]}`]) copyFileSync(path.join(workbook, file), path.join(copy, file));
            const output = await runWith((a, cli) => runRun(a, cli), folder, ['--workspace', ws(folder), COPY]);
            expect(output.code).toBe(1);
            expect(output.stderr).toBe('error: no tab of DashQL follows the session, open it with the line of dashql connect\n');
            // While the session runs, a workbook folder that the tab did not copy runs nowhere: in the session folder
            // and outside of it
            const own = path.join(folder, '.dashql', 'own');
            mkdirSync(path.join(own, 'scripts'), { recursive: true });
            for (const file of ['dashql-workbook.json', `scripts/${ORDERS[0]}`]) copyFileSync(path.join(workbook, file), path.join(own, file));
            const refused = (name: string) => `error: ${name} is no copy of a workbook of the tab of DashQL and would run outside the tab, the session of dashql connect in ${ws(folder)} runs only its copies in ${ws(folder)}/workbooks/\n`;
            for (const dir of [own, workbook]) {
                const other = await runWith((a, cli) => runRun(a, cli), dir, ['--workspace', ws(folder), '.']);
                expect(other.code).toBe(2);
                expect(other.stdout).toBe('');
                expect(other.stderr).toBe(refused('.'));
            }
            // A shell that changed into another folder names it with a relative workspace, which nobody set up: the run
            // fails instead of running outside the tab
            const relative = await runWith((a, cli) => runRun(a, cli), workbook, ['--workspace', '.dashql', '.']);
            expect(relative.code).toBe(2);
            expect(relative.stdout).toBe('');
            expect(relative.stderr).toBe(`error: .dashql ${NO_WORKSPACE}\n`);
        } finally {
            await server.close();
        }
    });
});
