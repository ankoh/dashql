import path from 'node:path';

import { DESCRIBE_TEXT, DESCRIBE_USAGE, runDescribe } from './describe_command.js';
import { noWorkspace } from './session_folder.js';
import { runWith, testFiles, testWorkspace } from './test_process.js';

const describeIn = (cwd: string, args: string[]) => runWith(async (a, cli) => runDescribe(a, cli), cwd, args);
/// The workspace of a folder that testWorkspace set up
const ws = (folder: string) => path.join(folder, '.dashql');

/// The workspace file with a running session, as the server writes it
const SESSION_FILE: [string, string] = ['.dashql/dashql-workspace.json', '{"formatVersion":1,"session":{"id":"s1","endpoint":"http://127.0.0.1:1","token":"t"}}'];

describe('dashql describe', () => {
    it('tells how to work on workbooks and lists the workbooks that the tab copied into the session of the workspace', async () => {
        const workbook = { name: 'Orders', connections: [{ connectionId: 'c1', name: 'Trino prod' }, { connectionId: 'hyper' }] };
        const workspace = testWorkspace([
            SESSION_FILE,
            ['.dashql/workbooks/w1/dashql-workbook.json', JSON.stringify(workbook)],
            ['.dashql/workbooks/w1/scripts/a.sql', 'select 1'],
            ['.dashql/workbooks/w1/scripts/b.sql', 'select 2'],
            ['.dashql/workbooks/w1/attachments/prices.parquet', 'PAR1'],
            ['.dashql/workbooks/w2/dashql-workbook.json', '{}'],
            // A copy that the tab is writing has no workbook file yet
            ['.dashql/workbooks/w3/attachments/t.parquet', 'PAR1'],
        ]);
        const output = await describeIn(workspace, ['--workspace', ws(workspace)]);
        expect(output.code).toBe(0);
        expect(output.stdout.startsWith(`${DESCRIBE_TEXT}\n\n`)).toBe(true);
        expect(output.stdout.endsWith([
            'Workbooks of DashQL in this session, the tab shows them (work on these folders, not on copies of them):',
            '  .dashql/workbooks/w1/  "Orders", 2 scripts, attachments: :prices, connections: Trino prod (c1), hyper',
            // A workbook without attachments says so, the agent reads none
            '  .dashql/workbooks/w2/  "w2", 0 scripts, attachments: none',
            '',
        ].join('\n'))).toBe(true);
        // The workspace names the session from any invoking directory, the folders are relative to it
        const elsewhere = testFiles([]);
        expect((await describeIn(elsewhere, ['--workspace', ws(workspace)])).stdout)
            .toContain(`  ${path.relative(elsewhere, path.join(ws(workspace), 'workbooks', 'w1'))}/  "Orders"`);
    });

    it('says when no session runs or no tab copied a workbook yet, and checks its arguments', async () => {
        const none = testWorkspace([]);
        expect((await describeIn(none, ['--workspace', ws(none)])).stdout.endsWith(`Workbooks of DashQL: no session of dashql connect runs in ${ws(none)}.\n`)).toBe(true);
        // Copies without the file of a session are no session
        const stale = testWorkspace([['.dashql/workbooks/w1/dashql-workbook.json', '{}']]);
        expect((await describeIn(stale, ['--workspace', ws(stale)])).stdout).toContain('no session of dashql connect runs in');
        const empty = testWorkspace([SESSION_FILE]);
        expect((await describeIn(empty, ['--workspace', ws(empty)])).stdout).toContain('Workbooks of DashQL in this session: none yet.');
        expect((await describeIn(none, ['--help'])).stdout).toBe(`${DESCRIBE_USAGE}\n`);
        // The .dashql/ of the invoking directory is the workspace by default
        expect(await describeIn(none, [])).toEqual(await describeIn(none, ['--workspace', ws(none)]));
        const wrong = await describeIn(none, ['--workspace', ws(none), 'orders']);
        expect(wrong.code).toBe(2);
        expect(wrong.stderr).toBe(`error: unexpected argument orders\n\n${DESCRIBE_USAGE}\n`);
        // A relative workspace, a folder that nobody set up and the folder around a workspace
        expect((await describeIn(none, ['-w', '.dashql'])).stdout).toContain('no session of dashql connect runs in');
        expect((await describeIn(ws(none), ['-w', '.'])).stdout).toContain('no session of dashql connect runs in');
        const unset = await describeIn(testFiles([]), []);
        expect(unset.code).toBe(2);
        expect(unset.stderr).toBe(`error: ${noWorkspace('.dashql')}\n`);
        const around = await describeIn(none, ['--workspace', '.']);
        expect(around.code).toBe(2);
        expect(around.stderr).toBe(`error: ${noWorkspace('.')}\n`);
    });

    it('lists the connections that the tab of the session lets the agent use', async () => {
        const describeWith = async (connections: string | null) => {
            const session = { id: 's1', endpoint: 'http://127.0.0.1:1', token: 't', ...(connections == null ? {} : { connections: JSON.parse(connections).connections }) };
            const workspace = testWorkspace([['.dashql/dashql-workspace.json', JSON.stringify({ formatVersion: 1, session })]]);
            return (await describeIn(workspace, ['--workspace', ws(workspace)])).stdout;
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
        expect((await describeIn(none, ['--workspace', ws(none)])).stdout).not.toContain('Connections');
    });
});
