import * as React from 'react';

import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as dashql from '@ankoh/dashql-core';
import { ResizeObserverMock } from '../../tests/mocks/view_mocks.js';
import { QueryProgressModels } from '../../query/query_progress_model.js';
import { ProfileProgressDetails } from './query_progress_panel.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
vi.stubGlobal('ResizeObserver', ResizeObserverMock);

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let core: dashql.DashQL;
beforeAll(async () => {
    core = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});

describe('ProfileProgressDetails', () => {
    let container: HTMLDivElement;
    let root: Root;
    beforeEach(() => {
        ResizeObserverMock.reset();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        core.resetUnsafe();
    });

    it('shows the status of the stage of every Trino operator', () => {
        const models = new QueryProgressModels();
        const stats = {
            state: 'RUNNING', completedSplits: 2, totalSplits: 20,
            rootStage: {
                stageId: '0', state: 'RUNNING', totalSplits: 2, completedSplits: 0,
                subStages: [{
                    stageId: '1', state: 'RUNNING', totalSplits: 8, completedSplits: 2,
                    // The tasks of the scan are done, the stage waits for the query
                    subStages: [{ stageId: '2', state: 'PENDING', totalSplits: 10, completedSplits: 10 }],
                }],
            },
        };
        models.apply(core, 1, { kind: 'trino_statement_stats', stats, receivedAt: 1 });
        const stage = (id: string, plan: object) => ({ stageId: `q.${id}`, plan: { jsonRepresentation: JSON.stringify(plan) } });
        const remote = (id: string, source: string) => ({ id, name: 'RemoteSource', descriptor: { sourceFragmentIds: `[${source}]` }, children: [] });
        const info = { queryId: 'q', stages: { stages: [
            stage('0', { id: '1', name: 'Output', children: [remote('2', '1')] }),
            stage('1', { id: '3', name: 'Aggregate', children: [remote('4', '2')] }),
            stage('2', { id: '5', name: 'TableScan', descriptor: { table: 'tpch:sf1:lineitem' }, children: [] }),
        ] } };
        const progress = models.apply(core, 1, { kind: 'trino_query_info', info, receivedAt: 2 })!;
        act(() => root.render(<ProfileProgressDetails progress={progress} />));

        // Every operator shows the status of its stage: the scan of the done stage a check, the others a spinner,
        // or the completed share of the splits of their stage once some are done
        const view = dashql.buffers.profile.ProfileExecutionStatus;
        const operators = [...container.querySelectorAll('[data-plan-operator-id]')].map(operator => ({
            label: operator.getAttribute('aria-label')!.split(',')[0],
            status: Number(operator.querySelector('[data-status]')?.getAttribute('data-status')),
            progress: operator.querySelector('[data-testid="operator-progress"]')?.getAttribute('stroke-dasharray') ?? null,
        }));
        expect(operators).toEqual([
            { label: 'lineitem', status: view.SUCCEEDED, progress: null },
            { label: 'RemoteSource', status: view.RUNNING, progress: '25 100' },
            { label: 'Aggregate', status: view.RUNNING, progress: '25 100' },
            { label: 'RemoteSource', status: view.RUNNING, progress: null },
            { label: 'Output', status: view.RUNNING, progress: null },
        ]);

        // The query finishes: the statement stats report every stage finished, QueryInfo the operator summaries
        const finished = (state: string) => ({ state, totalSplits: 2, completedSplits: 2 });
        models.apply(core, 1, { kind: 'trino_statement_stats', stats: {
            state: 'FINISHED', completedSplits: 20, totalSplits: 20,
            rootStage: { stageId: '0', ...finished('FINISHED'), subStages: [{ stageId: '1', ...finished('FINISHED'), subStages: [{ stageId: '2', ...finished('FINISHED') }] }] },
        }, receivedAt: 3 });
        const summary = (pipelineId: number, operatorId: number, planNodeId: string) =>
            ({ pipelineId, operatorId, planNodeId, inputPositions: 4, outputPositions: 4 });
        const summaries = (id: string, ops: object[]) => ({ stageId: `q.${id}`, state: 'FINISHED', stageStats: { operatorSummaries: ops } });
        const done = models.apply(core, 1, { kind: 'trino_query_info_stats', info: { queryId: 'q', state: 'FINISHED', stages: { stages: [
            summaries('0', [summary(0, 0, '2'), summary(0, 1, '1')]),
            summaries('1', [summary(0, 0, '4'), summary(0, 1, '3')]),
            summaries('2', [summary(0, 0, '5')]),
        ] } }, receivedAt: 4 })!;
        act(() => root.render(<ProfileProgressDetails progress={done} />));
        // Every operator shows a check, and only the check
        const shown = [...container.querySelectorAll('[data-plan-operator-id]')].map(operator =>
            [...operator.querySelectorAll('[data-status-icon]')]
                .filter(icon => getComputedStyle(icon).display !== 'none')
                .map(icon => Number(icon.getAttribute('data-status-icon'))));
        expect(shown).toEqual(Array(5).fill([view.SUCCEEDED]));
        // The check is cut out of the circle, not filled
        const check = container.querySelector(`[data-status-icon="${view.SUCCEEDED}"] path`) as SVGPathElement;
        expect(check.isPointInFill(new DOMPoint(2, 8))).toBe(true);
        expect(check.isPointInFill(new DOMPoint(6.75, 10))).toBe(false);
        models.release(1);
    });
});
