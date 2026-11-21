import { runCatalog, CATALOG_USAGE } from './catalog_command.js';
import { runWith, testFiles, testWorkspace } from './test_process.js';

/// What a command says to a folder that is no workspace, after its name
const NO_WORKSPACE = 'is no workspace of DashQL, it has no dashql-workspace.json. Pass the workspace that the start of the session of dashql connect names. Only the user sets up a workspace.';

/// catalog with the workspace of the folder that it runs in
const catalogIn = (cwd: string, args: string[]) => runWith(async (a, cli) => runCatalog(['-w', '.dashql', ...a], cli), cwd, args);

const WORKBOOK = {
    name: 'Orders',
    connections: [
        { connectionId: 'c1', name: 'Trino prod', params: { trino: { endpoint: 'https://trino.example' } } },
        { connectionId: 'hyper', params: { hyper: { protocol: 'WASM' } } },
    ],
    scripts: [{ name: 'orders.sql', connectionId: 'c1' }, { name: 'west.sql', connectionId: 'c1' }, { name: 'top.sql', connectionId: 'hyper' }],
};

const RELATIONS = `CREATE TABLE tpch.tiny.customer (custkey bigint, name varchar);
CREATE TABLE tpch.tiny.orders (orderkey bigint, custkey bigint, totalprice double);
`;

describe('dashql catalog', () => {
    it('prints the tables of the connections of a workbook', async () => {
        const dir = testWorkspace([
            ['dashql-workbook.json', JSON.stringify(WORKBOOK)],
            ['connections/c1/dashql-catalog-relations.sql', RELATIONS],
            ['attachments/sales.parquet', 'PAR1'],
            // A connection that the agent may use and that the workbook doesn't have yet
            ['connections/c2/dashql-catalog-relations.sql', 'CREATE TABLE s.t (a integer);\n'],
        ]);
        const output = await catalogIn(dir, ['.']);
        expect(output.stderr).toBe('');
        expect(output.code).toBe(0);
        expect(output.stdout).toBe(`-- Trino prod (c1): Trino, 2 scripts, 2 tables
${RELATIONS.trim()}

-- hyper (hyper): embedded Hyper, 1 script, 0 tables
-- No tables known yet, the tab of DashQL writes them once it knows the catalog of the connection
-- Attachments, scripts on the embedded Hyper read them as :name
--   :sales  attachments/sales.parquet

-- c2 (c2): 0 scripts, 1 table
CREATE TABLE s.t (a integer);
`);
        // A connection by its name or its id
        expect((await catalogIn(dir, ['.', 'trino PROD'])).stdout).toBe(`-- Trino prod (c1): Trino, 2 scripts, 2 tables\n${RELATIONS}`);
        expect((await catalogIn(dir, ['.', 'c2'])).stdout).toContain('-- c2 (c2)');
    });

    it('marks the connections that the agent may not use and cuts long catalogs', async () => {
        // A copy of the tab in the session of the workspace
        const copy = '.dashql/workbooks/w1';
        const dir = testWorkspace([
            [`${copy}/dashql-workbook.json`, JSON.stringify(WORKBOOK)],
            [`${copy}/connections/c1/dashql-catalog-relations.sql`, RELATIONS],
            ['.dashql/dashql-workspace.json', JSON.stringify({ formatVersion: 1, session: { id: 's1', endpoint: 'http://127.0.0.1:1', token: 't', connections: [{ connectionId: 'hyper', name: 'Hyper' }] } })],
        ]);
        const output = await catalogIn(dir, [copy, 'c1', 'hyper', '--max-chars', '70']);
        expect(output.stdout).toBe(`-- Trino prod (c1): Trino, 2 scripts, 2 tables, the tab of DashQL does not let the agent use it
CREATE TABLE tpch.tiny.customer (custkey bigint, name varchar);
-- Cut off after 70 characters, grep ${copy}/connections/c1/dashql-catalog-relations.sql for the rest

-- Hyper (hyper): embedded Hyper, 1 script, 0 tables
-- No tables known yet, the tab of DashQL writes them once it knows the catalog of the connection
`);
    });

    it('checks its arguments', async () => {
        const dir = testWorkspace([['dashql-workbook.json', JSON.stringify(WORKBOOK)]]);
        expect((await catalogIn(dir, ['--help'])).stdout).toBe(`${CATALOG_USAGE}\n`);
        const unknown = await catalogIn(dir, ['.', 'snowflake']);
        expect(unknown.code).toBe(2);
        expect(unknown.stderr).toBe('error: the workbook knows no connection snowflake, its connections are Trino prod (c1), hyper (hyper)\n');
        const none = await catalogIn(testWorkspace([]), ['.']);
        expect(none.code).toBe(2);
        expect(none.stderr).toBe('error: . is no workbook folder, it has no dashql-workbook.json\n');
        expect((await catalogIn(dir, [])).stderr).toBe(`error: missing the workbook folder\n\n${CATALOG_USAGE}\n`);
        // The .dashql/ of the invoking directory is the workspace by default
        const bare = await runWith(async (a, cli) => runCatalog(a, cli), dir, ['.', 'c1']);
        expect(bare).toEqual(await catalogIn(dir, ['.', 'c1']));
        const unsetHere = await runWith(async (a, cli) => runCatalog(a, cli), testFiles([['dashql-workbook.json', JSON.stringify(WORKBOOK)]]), ['.']);
        expect(unsetHere.code).toBe(2);
        expect(unsetHere.stderr).toBe(`error: .dashql ${NO_WORKSPACE}\n`);
        // A folder that nobody set up is no workspace, nor the folder around a workspace
        const unset = await catalogIn(testFiles([['dashql-workbook.json', JSON.stringify(WORKBOOK)]]), ['.']);
        expect(unset.code).toBe(2);
        expect(unset.stderr).toBe(`error: .dashql ${NO_WORKSPACE}\n`);
        const around = await runWith(async (a, cli) => runCatalog(['-w', '.', ...a], cli), dir, ['.']);
        expect(around.code).toBe(2);
        expect(around.stderr).toBe(`error: . ${NO_WORKSPACE}\n`);
    });
});
