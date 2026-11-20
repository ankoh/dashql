import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import * as arrow from 'apache-arrow';

import { createDashQLCoreSetup } from '@akohn/dashql/platform/node/node_core';
import {
    followAgentSession,
    postAgentSessionRunEvent,
    writeAgentSessionWorkbook,
    type AgentSessionRunMessage,
} from '@akohn/dashql/platform/session/agent_session_client';
import { encodeRunEvent } from '@akohn/dashql/platform/workbook/run_events';

import type { RunEnvironment } from './run_command.js';
import { startSessionServer } from './session_server.js';
import { runWith, testFiles } from './test_process.js';
import { runVis, scriptChart, VIS_USAGE } from './vis_command.js';

const WORKBOOK_ID = '3c2b1a0f-9e8d-4c7b-8a69-5f4e3d2c1b0a';
const HYPER_ID = '7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d';
const REVENUE = `select 'west' as region, 3 as revenue
union all select 'east', 5`;

/// The workbook file of a workbook with scripts on the embedded Hyper
function workbookFile(names: string[]): string {
    return JSON.stringify({
        formatVersion: 11,
        workbookId: WORKBOOK_ID,
        name: 'Revenue',
        connections: [{ connectionId: HYPER_ID, params: { hyper: { protocol: 'WASM' } } }],
        scripts: names.map(name => ({ name, connectionId: HYPER_ID })),
        attachments: [],
        metadata: {},
    }, null, 2);
}

/// A workbook folder with scripts on the embedded Hyper
function hyperWorkbook(scripts: Array<[string, string]>): string {
    return testFiles([
        ['dashql-workbook.json', workbookFile(scripts.map(([name]) => name))],
        ...scripts.map(([name, text]): [string, string] => [`scripts/${name}`, text]),
    ]);
}

/// A script with a chart above its query
const charted = (spec: object) => `/**
 * Revenue per region.
 *
 * @vis vegalite
 * ${JSON.stringify(spec)}
 */
${REVENUE};
`;

const BAR = { mark: 'bar', encoding: { x: { field: 'region', type: 'nominal' }, y: { field: 'revenue', type: 'quantitative' } } };

const tempHome = () => mkdtempSync(path.join(process.env.TEST_TMPDIR ?? tmpdir(), 'dashql-home-'));
const vis = (dir: string, args: string[], env: Partial<RunEnvironment> = {}) =>
    runWith((visArgs, cli) => runVis(visArgs, cli, { home: tempHome(), ...env }), dir, args);

/// The bytes of a PNG as a tab sends them
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe('dashql vis', () => {
    it('reads the chart of a script with the core', async () => {
        const dql = await createDashQLCoreSetup()('test');
        expect(scriptChart(dql, charted(BAR))).toEqual({ renderer: 'vegalite', spec: BAR, errors: [] });
        expect(scriptChart(dql, `-- @vis table\n${REVENUE}`).renderer).toBe('table');
        expect(scriptChart(dql, REVENUE).renderer).toBeNull();
    });

    it('checks the chart against the result of a run in this process, the PNG comes only from the tab', async () => {
        const dir = hyperWorkbook([['revenue.sql', charted(BAR)]]);
        const output = await vis(dir, ['.', 'revenue']);
        expect(output.stderr).toBe('');
        expect(output.stdout).toBe(`revenue.sql: @vis vegalite, 2 rows, columns region, revenue
No problems.
No PNG: the tab of DashQL renders it, for a workbook that it copied into a session of dashql connect
`);
        expect(output.code).toBe(0);
    }, 60_000);

    it('reports fields that the result lacks and sizes that DashQL decides', async () => {
        const spec = { ...BAR, width: 300, encoding: { ...BAR.encoding, color: { field: 'segment' } } };
        const dir = hyperWorkbook([['revenue.sql', charted(spec)]]);
        const output = await vis(dir, ['.', 'scripts/revenue.sql']);
        expect(output.code).toBe(1);
        expect(output.stdout).toContain('  - leave the size to DashQL, it fits every chart to its card: remove width\n');
        expect(output.stdout).toContain('  - the field "segment" is no column of the result, its columns are region, revenue\n');
    }, 60_000);

    it('asks the tab for the chart of a copy and writes its PNG', async () => {
        const session = '51030';
        const folder = testFiles([]);
        const server = await startSessionServer({ harness: 'claude', folder, session });
        const target = { endpoint: `http://127.0.0.1:${server.port}`, token: server.token };
        const tab = new AbortController();
        const runs: Array<Extract<AgentSessionRunMessage, { type: 'run' }>> = [];
        try {
            let followed: () => void = () => { };
            const following = new Promise<void>(resolve => { followed = resolve; });
            const table = arrow.tableFromArrays({ region: ['west', 'east'], revenue: Int32Array.from([3, 5]) });
            void followAgentSession(target, () => followed(), tab.signal, message => {
                if (message.type !== 'run') return;
                runs.push(message);
                const send = (event: Parameters<typeof encodeRunEvent>[0]) => postAgentSessionRunEvent(target, message.runId, encodeRunEvent(event, message.rows));
                void (async () => {
                    await send({ type: 'run_started', workbook: message.label, scripts: ['revenue.sql'] });
                    await send({ type: 'script_done', script: 'revenue.sql', ms: 5, rows: 2, table, cached: true, key: null, file: null });
                    await send({ type: 'script_chart', script: 'revenue.sql', png: PNG, width: 400, height: 300, error: null });
                    await send({ type: 'run_finished', ms: 6, ok: 1, failed: 0, cancelled: 0, notRun: 0, interrupted: false });
                })();
            }).catch(() => { });
            await following;
            await writeAgentSessionWorkbook(target, WORKBOOK_ID, [
                { path: 'dashql-workbook.json', content: workbookFile(['revenue.sql']) },
                { path: 'scripts/revenue.sql', content: charted(BAR) },
            ]);
            const output = await vis(folder, ['--workspace', '.', '--session', session, `.dashql/workbooks/${WORKBOOK_ID}`, 'revenue', '--width', '400', '--height', '300', '--scale', '1']);
            expect(output.stderr).toBe('');
            expect(output.stdout).toBe(`revenue.sql: @vis vegalite, 2 rows, columns region, revenue
No problems.
Wrote .dashql/charts/revenue.png (400x300 pixels), look at it to check the chart
`);
            expect(output.code).toBe(0);
            expect([...readFileSync(path.join(folder, '.dashql', 'charts', 'revenue.png'))]).toEqual([...PNG]);
            // The run asks for the chart in the size of the arguments, the result goes with its columns only
            expect(runs).toEqual([expect.objectContaining({ scripts: ['revenue.sql'], rows: 0, chart: { width: 400, height: 300, scale: 1 } })]);
            expect(existsSync(path.join(folder, 'revenue.png'))).toBe(false);
        } finally {
            tab.abort();
            await server.close();
        }
    });

    it('says when a script has no chart and checks its arguments', async () => {
        const dir = hyperWorkbook([['revenue.sql', `${REVENUE};\n`]]);
        const none = await vis(dir, ['.', 'revenue.sql']);
        expect(none.code).toBe(1);
        expect(none.stdout).toBe('revenue.sql has no chart: add a @vis tag to the comment above its last query, see dashql describe\n');
        expect((await vis(dir, ['--help'])).stdout).toBe(`${VIS_USAGE}\n`);
        const missing = await vis(dir, ['.', 'orders']);
        expect(missing.code).toBe(2);
        expect(missing.stderr).toBe('error: the workbook has no script scripts/orders.sql\n');
        const usage = await vis(dir, ['.']);
        expect(usage.code).toBe(2);
        expect(usage.stderr).toBe(`error: missing the workbook folder or the script\n\n${VIS_USAGE}\n`);
        expect((await vis(dir, ['.', 'revenue', '--scale', '9'])).stderr).toContain('error: --scale takes a number up to 4');
    });
});
