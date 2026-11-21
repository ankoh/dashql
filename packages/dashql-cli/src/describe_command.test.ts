import { DESCRIBE_TEXT, DESCRIBE_USAGE, runDescribe } from './describe_command.js';
import { runWith, testFiles, testWorkspace } from './test_process.js';

/// What a command says to a folder that is no workspace, after its name
const NO_WORKSPACE = 'is no workspace of DashQL, it has no .dashql/. Pass the workspace that the start of the session of dashql connect names. Only the user sets up a workspace.';

const describeIn = (cwd: string, args: string[]) => runWith(async (a, cli) => runDescribe(a, cli), cwd, args);

/// The file of a running session, as the server writes it
const SESSION_FILE: [string, string] = ['.dashql/session/session.json', '{"id":"s1","endpoint":"http://127.0.0.1:1","token":"t"}'];

describe('dashql describe', () => {
    it('tells how to work on workbooks and lists the workbooks that the tab copied into the session of the workspace', async () => {
        const workbook = { name: 'Orders', connections: [{ connectionId: 'c1', name: 'Trino prod' }, { connectionId: 'hyper' }] };
        const workspace = testFiles([
            SESSION_FILE,
            ['.dashql/session/workbooks/w1/dashql-workbook.json', JSON.stringify(workbook)],
            ['.dashql/session/workbooks/w1/scripts/a.sql', 'select 1'],
            ['.dashql/session/workbooks/w1/scripts/b.sql', 'select 2'],
            ['.dashql/session/workbooks/w1/attachments/prices.parquet', 'PAR1'],
            ['.dashql/session/workbooks/w2/dashql-workbook.json', '{}'],
            // A copy that the tab is writing has no workbook file yet
            ['.dashql/session/workbooks/w3/attachments/t.parquet', 'PAR1'],
        ]);
        const output = await describeIn(workspace, ['--workspace', workspace]);
        expect(output.code).toBe(0);
        expect(output.stdout.startsWith(`${DESCRIBE_TEXT}\n\n`)).toBe(true);
        expect(output.stdout.endsWith([
            'Workbooks of DashQL in this session, the tab shows them (work on these folders, not on copies of them):',
            '  .dashql/session/workbooks/w1/  "Orders", 2 scripts, attachments: :prices, connections: Trino prod (c1), hyper',
            // A workbook without attachments says so, the agent reads none
            '  .dashql/session/workbooks/w2/  "w2", 0 scripts, attachments: none',
            '',
        ].join('\n'))).toBe(true);
        // The workspace names the session from any invoking directory
        expect((await describeIn(testFiles([]), ['--workspace', workspace])).stdout).toBe(output.stdout);
    });

    it('says when no session runs or no tab copied a workbook yet, and checks its arguments', async () => {
        const none = testWorkspace([]);
        expect((await describeIn(none, ['--workspace', none])).stdout.endsWith(`Workbooks of DashQL: no session of dashql connect runs in ${none}.\n`)).toBe(true);
        // Copies without the file of a session are no session
        const stale = testFiles([['.dashql/session/workbooks/w1/dashql-workbook.json', '{}']]);
        expect((await describeIn(stale, ['--workspace', stale])).stdout).toContain('no session of dashql connect runs in');
        const empty = testFiles([SESSION_FILE]);
        expect((await describeIn(empty, ['--workspace', empty])).stdout).toContain('Workbooks of DashQL in this session: none yet.');
        expect((await describeIn(none, ['--help'])).stdout).toBe(`${DESCRIBE_USAGE}\n`);
        // The invoking directory is the workspace by default
        expect(await describeIn(none, [])).toEqual(await describeIn(none, ['--workspace', none]));
        const wrong = await describeIn(none, ['--workspace', none, 'orders']);
        expect(wrong.code).toBe(2);
        expect(wrong.stderr).toBe(`error: unexpected argument orders\n\n${DESCRIBE_USAGE}\n`);
        // A relative workspace, and a folder that nobody set up
        expect((await describeIn(none, ['-w', '.'])).stdout).toContain('no session of dashql connect runs in');
        const unset = await describeIn(testFiles([]), ['--workspace', '.']);
        expect(unset.code).toBe(2);
        expect(unset.stderr).toBe(`error: . ${NO_WORKSPACE}\n`);
    });

    it('lists the connections that the tab of the session lets the agent use', async () => {
        const describeWith = async (connections: string | null) => {
            const workspace = testFiles(connections == null ? [SESSION_FILE] : [SESSION_FILE, ['.dashql/session/connections.json', connections]]);
            return (await describeIn(workspace, ['--workspace', workspace])).stdout;
        };
        const allowed = { connections: [{ connectionId: 'c1', name: 'Trino prod' }, { connectionId: 'hyper', name: 'Hyper' }] };
        expect((await describeWith(JSON.stringify(allowed))).endsWith(`
Connections that the tab of DashQL lets you use, dashql run refuses the others:
  Trino prod (c1)
  Hyper (hyper)
`)).toBe(true);
        expect(await describeWith('{"connections":[]}')).toContain('Connections: the tab of DashQL lets you use none');
        // Before the tab told them, and without a session, nothing is said about them
        expect(await describeWith(null)).not.toContain('Connections');
        const none = testWorkspace([]);
        expect((await describeIn(none, ['--workspace', none])).stdout).not.toContain('Connections');
    });
});
