import { runCatalog, CATALOG_USAGE } from './catalog_command.js';
import { runWith, testFiles } from './test_process.js';

const catalogIn = (cwd: string, args: string[]) => runWith(async (a, cli) => runCatalog(a, cli), cwd, args);

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
        const dir = testFiles([
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
        const dir = testFiles([
            ['dashql-workbook.json', JSON.stringify(WORKBOOK)],
            ['connections/c1/dashql-catalog-relations.sql', RELATIONS],
            ['.dashql/sessions/51001/connections.json', JSON.stringify({ connections: [{ connectionId: 'hyper', name: 'Hyper' }] })],
        ]);
        const output = await catalogIn(dir, ['--workspace', '.', '--session', '51001', '.', 'c1', 'hyper', '--max-chars', '70']);
        expect(output.stdout).toBe(`-- Trino prod (c1): Trino, 2 scripts, 2 tables, the tab of DashQL does not let the agent use it
CREATE TABLE tpch.tiny.customer (custkey bigint, name varchar);
-- Cut off after 70 characters, grep connections/c1/dashql-catalog-relations.sql for the rest

-- Hyper (hyper): embedded Hyper, 1 script, 0 tables
-- No tables known yet, the tab of DashQL writes them once it knows the catalog of the connection
`);
    });

    it('checks its arguments', async () => {
        const dir = testFiles([['dashql-workbook.json', JSON.stringify(WORKBOOK)]]);
        expect((await catalogIn(dir, ['--help'])).stdout).toBe(`${CATALOG_USAGE}\n`);
        const unknown = await catalogIn(dir, ['.', 'snowflake']);
        expect(unknown.code).toBe(2);
        expect(unknown.stderr).toBe('error: the workbook knows no connection snowflake, its connections are Trino prod (c1), hyper (hyper)\n');
        const none = await catalogIn(testFiles([]), ['.']);
        expect(none.code).toBe(2);
        expect(none.stderr).toBe('error: . is no workbook folder, it has no dashql-workbook.json\n');
        expect((await catalogIn(dir, [])).stderr).toBe(`error: missing the workbook folder\n\n${CATALOG_USAGE}\n`);
        // A session needs its folder, a copy of a tab needs the session
        expect((await catalogIn(dir, ['--session', '51001', '.'])).stderr).toBe('error: --session needs --workspace, the folder of the session\n');
        expect((await catalogIn(dir, ['--workspace', '.', '--session', '51009', '.'])).stderr).toBe(`error: no session 51009 runs in ${dir}\n`);
        const workspace = testFiles([['.dashql/workbooks/w1/dashql-workbook.json', JSON.stringify(WORKBOOK)]]);
        const copy = await catalogIn(workspace, ['.dashql/workbooks/w1']);
        expect(copy.code).toBe(2);
        expect(copy.stderr).toBe('error: .dashql/workbooks/w1 is the copy of a workbook of the tab of DashQL, pass --workspace <folder> --session <id> as the start of the session says\n');
    });
});
