import { describe, expect, it, vi } from 'vitest';

import type { WorkbookResultFiles } from '@akohn/dashql/platform/workbook/workbook_result_files';

import type { Logger } from '@akohn/dashql/platform/logger/logger';
import type { Runtime } from '@akohn/dashql/runtime/runtime';

import { AGENT_PAUSED_ERROR, AgentSessionRuns, sendStoredResult } from './agent_session_runs.js';

describe('the runs of the agent in the tab', () => {
    it('sends the stored result of a script while it is pinned, nothing without one', async () => {
        const order: string[] = [];
        const runtime = {
            withStoredResult: vi.fn(async (_workbookId: string, script: string, callback: (name: string) => Promise<unknown>) => {
                if (script !== 'a.sql') return null;
                try {
                    return await callback('a.k.1.parquet');
                } finally {
                    order.push('release');
                }
            }),
        } as unknown as Runtime;
        const results = {
            readFile: vi.fn(async (_workbookId: string, name: string) => {
                order.push(`read ${name}`);
                return new Blob(['PAR1']);
            }),
        } as unknown as WorkbookResultFiles;
        const write = vi.fn(async (name: string, data: Blob) => {
            order.push(`write ${name} ${await data.text()}`);
            return `/work/.dashql/workbooks/w/results/${name}`;
        });
        expect(await sendStoredResult(runtime, results, 'w', 'a.sql', write)).toBe('/work/.dashql/workbooks/w/results/a.k.1.parquet');
        expect(order).toEqual(['read a.k.1.parquet', 'write a.k.1.parquet PAR1', 'release']);
        expect(await sendStoredResult(runtime, results, 'w', 'other.sql', write)).toBeNull();
        expect(await sendStoredResult(runtime, null, 'w', 'a.sql', write)).toBeNull();
        // A failed write still releases the file
        order.length = 0;
        await expect(sendStoredResult(runtime, results, 'w', 'a.sql', async () => { throw new Error('gone'); })).rejects.toThrow('gone');
        expect(order).toEqual(['read a.k.1.parquet', 'release']);
    });

    it('runs nothing for the agent while the user has the workbook', async () => {
        const sent: unknown[] = [];
        const runs = new AgentSessionRuns({
            runtime: {} as Runtime,
            settled: async () => { },
            isConnectionAllowed: () => true,
            paused: () => true,
            send: async (_runId, event) => {
                sent.push(event);
                return true;
            },
            writeResult: async () => null,
            renderChart: async () => { throw new Error('no chart'); },
        }, { info: () => { }, warn: () => { } } as unknown as Logger);
        runs.handle({ type: 'run', runId: 'r1', workbookId: 'w1', label: 'w1', scripts: [], refresh: false, rows: 3 });
        await vi.waitFor(() => expect(sent).toHaveLength(2));
        expect(sent[0]).toEqual({ type: 'run_failed', error: AGENT_PAUSED_ERROR });
        expect(sent[1]).toMatchObject({ type: 'run_finished', interrupted: false });
    });
});
