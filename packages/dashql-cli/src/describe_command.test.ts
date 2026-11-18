import path from 'node:path';

import { DESCRIBE_TEXT, DESCRIBE_USAGE, runDescribe } from './describe_command.js';
import { runWith, testFiles } from './test_process.js';

const describeIn = (cwd: string, args: string[] = [], session: string | null = null) => runWith(async (a, cli) => runDescribe(a, cli, session), cwd, args);

describe('dashql describe', () => {
    it('tells how to work on workbooks and lists the workbooks that the tabs copied', async () => {
        const workbook = { name: 'Orders', connections: [{ connectionId: 'c1', name: 'Trino prod' }, { connectionId: 'hyper' }] };
        const workspace = testFiles([
            ['.dashql/workbooks/w1/dashql-workbook.json', JSON.stringify(workbook)],
            ['.dashql/workbooks/w1/scripts/a.sql', 'select 1'],
            ['.dashql/workbooks/w1/scripts/b.sql', 'select 2'],
            ['.dashql/workbooks/w1/attachments/prices.parquet', 'PAR1'],
            ['.dashql/workbooks/w2/dashql-workbook.json', '{}'],
            // The mirror of the attachments of a workbook of dashql run has no workbook file
            ['.dashql/workbooks/w3/attachments/t.parquet', 'PAR1'],
        ]);
        const output = await describeIn(path.join(workspace));
        expect(output.code).toBe(0);
        expect(output.stdout.startsWith(`${DESCRIBE_TEXT}\n\n`)).toBe(true);
        expect(output.stdout.endsWith([
            'Workbooks of DashQL in this folder, the tab shows them (work on these folders, not on copies of them):',
            '  .dashql/workbooks/w1/  "Orders", 2 scripts, attachments: :prices, connections: Trino prod (c1), hyper',
            // A workbook without attachments says so, the agent reads none
            '  .dashql/workbooks/w2/  "w2", 0 scripts, attachments: none',
            '',
        ].join('\n'))).toBe(true);

        // A workspace that the invoking directory is not
        expect((await describeIn(path.join(workspace, '.dashql'), ['--workspace', '..'])).stdout).toBe(output.stdout);
    });

    it('says when no tab copied a workbook yet and checks its arguments', async () => {
        const output = await describeIn(testFiles([]));
        expect(output.stdout).toContain('Workbooks of DashQL in this folder: none yet.');
        expect((await describeIn(testFiles([]), ['--help'])).stdout).toBe(`${DESCRIBE_USAGE}\n`);
        const wrong = await describeIn(testFiles([]), ['orders']);
        expect(wrong.code).toBe(2);
        expect(wrong.stderr).toBe(`error: unexpected argument orders\n\n${DESCRIBE_USAGE}\n`);
    });

    it('lists the connections that the tab of the session lets the agent use', async () => {
        const allowed = { connections: [{ connectionId: 'c1', name: 'Trino prod' }, { connectionId: 'hyper', name: 'Hyper' }] };
        const workspace = testFiles([
            ['.dashql/sessions/51001/connections.json', JSON.stringify(allowed)],
            ['.dashql/sessions/51002/connections.json', '{"connections":[]}'],
        ]);
        expect((await describeIn(workspace, [], '51001')).stdout.endsWith(`
Connections that the tab of DashQL lets you use, dashql run refuses the others:
  Trino prod (c1)
  Hyper (hyper)
`)).toBe(true);
        expect((await describeIn(workspace, [], '51002')).stdout).toContain('Connections: the tab of DashQL lets you use none');
        // Before the tab told them, and outside a session, nothing is said about them
        expect((await describeIn(workspace, [], '51003')).stdout).not.toContain('Connections');
        expect((await describeIn(workspace)).stdout).not.toContain('Connections');
    });
});
