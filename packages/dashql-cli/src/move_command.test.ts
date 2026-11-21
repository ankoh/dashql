import { readFileSync } from 'node:fs';
import path from 'node:path';

import { MOVE_USAGE, runMove } from './move_command.js';
import { runWith, testFiles } from './test_process.js';

const moveIn = (cwd: string, args: string[]) => runWith(async (a, cli) => runMove(a, cli), cwd, args);

/// A workbook folder with three scripts on two connections and fields of its own
function workbookFolder(): string {
    return testFiles([
        ['dashql-workbook.json', JSON.stringify({
            name: 'Orders',
            connections: [{ connectionId: 'c1' }, { connectionId: 'hyper' }],
            scripts: [{ name: 'orders.sql', connectionId: 'c1' }, { name: 'top.sql', connectionId: 'c1' }, { name: 'chart.sql', connectionId: 'hyper' }],
        })],
        ['scripts/orders.sql', 'select 1'],
        ['scripts/top.sql', 'select 2'],
        ['scripts/chart.sql', 'select 3'],
        ['scripts/new.sql', 'select * from :orders'],
    ]);
}

/// The workbook file of a folder
const workbookOf = (dir: string) => JSON.parse(readFileSync(path.join(dir, 'dashql-workbook.json'), 'utf8'));
const order = (dir: string) => workbookOf(dir).scripts.map((script: { name: string }) => script.name);

describe('dashql move', () => {
    it('moves a script before or after another one, first or last, and prints the order', async () => {
        const dir = workbookFolder();
        expect(await moveIn(dir, ['.', 'chart', '--after', 'orders'])).toEqual({ code: 0, stdout: 'orders.sql\nchart.sql\ntop.sql\n', stderr: '' });
        // The names of the scripts as the agent writes them
        expect((await moveIn(dir, ['.', 'scripts/top.sql', '--before', 'orders.sql'])).code).toBe(0);
        expect(order(dir)).toEqual(['top.sql', 'orders.sql', 'chart.sql']);
        expect((await moveIn(dir, ['.', 'top', '--last'])).code).toBe(0);
        expect(order(dir)).toEqual(['orders.sql', 'chart.sql', 'top.sql']);
        expect((await moveIn(dir, ['.', 'chart', '--first'])).code).toBe(0);
        expect(order(dir)).toEqual(['chart.sql', 'orders.sql', 'top.sql']);
        // The other fields and the connections of the scripts stay
        const workbook = workbookOf(dir);
        expect(workbook.name).toBe('Orders');
        expect(workbook.connections).toEqual([{ connectionId: 'c1' }, { connectionId: 'hyper' }]);
        expect(workbook.scripts[0]).toEqual({ name: 'chart.sql', connectionId: 'hyper' });
    });

    it('lists a script of the folder that the workbook file does not name yet, on the connection of its neighbor', async () => {
        const dir = workbookFolder();
        expect((await moveIn(dir, ['.', 'new', '--after', 'chart'])).code).toBe(0);
        expect(workbookOf(dir).scripts.at(-1)).toEqual({ name: 'new.sql', connectionId: 'hyper' });
        const first = workbookFolder();
        expect((await moveIn(first, ['.', 'new', '--first'])).code).toBe(0);
        expect(workbookOf(first).scripts[0]).toEqual({ name: 'new.sql', connectionId: 'c1' });
    });

    it('checks its arguments', async () => {
        const dir = workbookFolder();
        expect((await moveIn(dir, ['--help'])).stdout).toBe(`${MOVE_USAGE}\n`);
        const usage = async (args: string[], error: unknown) => {
            const output = await moveIn(dir, args);
            expect(output.code, args.join(' ')).toBe(2);
            expect(output.stderr, args.join(' ')).toEqual(error);
        };
        await usage(['.', 'chart'], `error: name one place: --before <script>, --after <script>, --first or --last\n\n${MOVE_USAGE}\n`);
        await usage(['.', 'chart', '--first', '--last'], `error: name one place: --before <script>, --after <script>, --first or --last\n\n${MOVE_USAGE}\n`);
        await usage(['.', '--first'], `error: missing the workbook folder or the script\n\n${MOVE_USAGE}\n`);
        await usage(['.', 'gone', '--first'], 'error: the workbook has no script scripts/gone.sql\n');
        await usage(['.', 'chart', '--after', 'gone'], 'error: dashql-workbook.json lists no script gone.sql, its scripts are orders.sql, top.sql\n');
        await usage(['.', 'chart', '--after', 'chart'], "error: chart.sql can't go after itself\n");
        await usage([testFiles([]), 'chart', '--first'], expect.stringContaining('is no workbook folder'));
        // Nothing changed
        expect(order(dir)).toEqual(['orders.sql', 'top.sql', 'chart.sql']);
    });
});
