import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectionHealth, type ConnectionState } from '../../connections/connection_state.js';
import { EXECUTOR_CTX, type QueryExecutorContextValue } from '../../connections/query_executor.js';
import { LoggerProvider } from '../../platform/logger/logger_provider.js';
import { QueryExecutionStatus } from '../../query/query_execution_state.js';
import { flushContinuousUpdates } from '../../tests/react_act.js';
import type { RenameDraftReferences } from '../scripts/script_rename.js';
import type { ModifySessionScripts } from '../scripts/session_scripts_registry.js';
import {
    ACCEPT_PENDING_DIFF,
    DELETE_SCRIPT,
    REJECT_PENDING_DIFF,
    RENAME_SCRIPT,
    SET_SCRIPT_TEXT,
    SET_SCRIPT_VIS_SPEC,
    type ScriptData,
    type SessionScripts,
} from '../scripts/session_scripts.js';
import type { DashboardCardDependencies } from './dashboard_card.js';
import { Dashboard, type DashboardDependencies } from './dashboard.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const state = {
    queries: new Map<number, unknown>(),
};

const cardDependencies = {
    useQueryState: (_sessionId: string, queryId: number | null) => queryId == null ? null : state.queries.get(queryId) ?? null,
    QueryResultPanel: (props: { onShowTable?: () => void }) => <button data-testid="card-table" onClick={props.onShowTable}>table</button>,
    VisualizationDispatch: () => <div data-testid="card-visualization" />,
    ScriptEditor: () => <div data-testid="card-editor" />,
} as unknown as DashboardCardDependencies;

interface VisOptions {
    renderer: 'table' | 'vegalite' | 'markdown';
    spec?: { row?: number; column?: number; width?: number; height?: number };
}

function script(scriptKey: number, fileName: string, options: { vis?: VisOptions; latestQueryId?: number; pendingDiff?: boolean } = {}): ScriptData {
    return {
        scriptKey,
        fileName,
        latestQueryId: options.latestQueryId ?? null,
        connection: { connectionId: 'db' },
        pendingDiff: options.pendingDiff ? { priorText: 'select 0', diffBuffer: null } : null,
        annotations: {
            lastStatementIsQuery: true,
            boardPosition: null,
            visualizeQuery: options.vis == null ? null : {
                renderer: options.vis.renderer, sql: 'select 1', statementId: 0, vegaLiteSpec: {}, dashboardSpec: options.vis.spec ?? null,
            },
        },
        scriptSession: {
            // A script without a visualization shows its last statement
            compileQuery: () => ({ read: () => ({ terminalStatementId: () => 1 }) }),
            rewriteVisBoard: (statementId: number, row: number, column: number, width: number, height: number) =>
                `board ${statementId} ${row} ${column} ${width} ${height}`,
            rewriteVisRenderer: (statementId: number, renderer: string | null, body: string) => {
                if (body === 'throw') throw new Error('cannot rewrite');
                return `renderer ${statementId} ${renderer} ${body}`;
            },
        },
    } as unknown as ScriptData;
}

function session(...scripts: ScriptData[]): SessionScripts {
    return {
        sessionId: 'session',
        scriptOrder: scripts.map(s => s.fileName),
        scriptRefs: Object.fromEntries(scripts.map(s => [s.fileName, { scriptId: s.scriptKey }])),
        scripts: Object.fromEntries(scripts.map(s => [s.scriptKey, s])),
    } as unknown as SessionScripts;
}

const SETUP = script(1, '1_setup.sql');
const SALES = script(2, '2_sales.sql', { vis: { renderer: 'table', spec: { row: 0, column: 6, width: 6, height: 3 } }, latestQueryId: 20 });
const TREND = script(3, '3_trend.sql', { vis: { renderer: 'vegalite', spec: { row: 0, column: 0, width: 6, height: 3 } }, latestQueryId: 30 });

describe('Dashboard', () => {
    let container: HTMLDivElement;
    let root: Root;
    let modify: ReturnType<typeof vi.fn>;
    let executor: QueryExecutorContextValue;
    let runSessionScript: ReturnType<typeof vi.fn>;
    let dependencies: DashboardDependencies;

    beforeEach(() => {
        container = document.createElement('div');
        container.style.width = '1200px';
        container.style.height = '800px';
        container.style.display = 'flex';
        document.body.appendChild(container);
        root = createRoot(container);
        state.queries = new Map<number, unknown>([
            [20, { queryId: 20, status: QueryExecutionStatus.SUCCEEDED, resultTable: { schema: { fields: [{ name: 'region' }, { name: 'revenue' }] } } }],
            [30, { queryId: 30, status: QueryExecutionStatus.RUNNING }],
        ]);
        modify = vi.fn();
        executor = { execute: vi.fn(), cancel: vi.fn(), watchProfile: vi.fn() } as unknown as QueryExecutorContextValue;
        runSessionScript = vi.fn(async () => {});
        dependencies = {
            runSessionScript: runSessionScript as unknown as DashboardDependencies['runSessionScript'],
            DashboardEditorOverlay: (props: { script: ScriptData; onAcceptDiff: (key: number) => void; onRejectDiff: (key: number) => void; onClose: () => void }) => (
                <div data-testid="editor-overlay" data-script={props.script.fileName}>
                    <button data-testid="editor-accept" onClick={() => props.onAcceptDiff(props.script.scriptKey)} />
                    <button data-testid="editor-reject" onClick={() => props.onRejectDiff(props.script.scriptKey)} />
                    <button data-testid="overlay-close" onClick={props.onClose} />
                </div>
            ),
            DashboardTableOverlay: (props: { script: ScriptData; onClose: () => void }) => (
                <div data-testid="table-overlay" data-script={props.script.fileName}>
                    <button data-testid="overlay-close" onClick={props.onClose} />
                </div>
            ),
            DashboardChartOverlay: (props: { script: ScriptData; onChange: (spec: string) => void; onClose: () => void }) => (
                <div data-testid="chart-overlay" data-script={props.script.fileName}>
                    <button data-testid="chart-change" onClick={() => props.onChange('{"mark":"line"}')} />
                    <button data-testid="overlay-close" onClick={props.onClose} />
                </div>
            ),
            card: cardDependencies,
        } as unknown as DashboardDependencies;
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    const online = new Map([['db', { connectionHealth: ConnectionHealth.ONLINE } as ConnectionState]]);

    function render(sessionScripts: SessionScripts, extra: { scriptConnections?: ReadonlyMap<string, ConnectionState>; draftRenameRef?: React.RefObject<RenameDraftReferences | null> } = {}) {
        act(() => root.render(
            <LoggerProvider>
                <EXECUTOR_CTX.Provider value={executor}>
                    <Dashboard
                        sessionScripts={sessionScripts}
                        modifySessionScripts={modify as unknown as ModifySessionScripts}
                        scriptConnections={extra.scriptConnections ?? online}
                        draftRenameRef={extra.draftRenameRef}
                        dependencies={dependencies}
                    />
                </EXECUTOR_CTX.Provider>
            </LoggerProvider>,
        ));
    }

    const section = (label: string) => container.querySelector<HTMLElement>(`[role="group"][aria-label="${label}"]`);
    const cards = (label: string) => [...(section(label)?.querySelectorAll('[data-dashboard-card]') ?? [])]
        .map(card => Number(card.getAttribute('data-dashboard-card')));
    const card = (key: number) => container.querySelector<HTMLElement>(`[data-dashboard-card="${key}"]`)!;
    const cardButton = (key: number, id: string) => card(key).querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!;
    const testId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    const actions = () => modify.mock.calls.map(([action]) => action);
    const resizeHandle = (key: number) => card(key).querySelector<HTMLButtonElement>('button[aria-label^="Resize"]')!;

    it('shows an empty state without scripts', () => {
        render(session());
        expect(container.textContent).toContain('No scripts yet');
        expect(container.querySelector('[data-dashboard-card]')).toBeNull();
    });

    it('puts the scripts without a visualization on top and orders the cards by their placement', async () => {
        render(session(SETUP, SALES, TREND));
        expect(cards('Scripts without visualization')).toEqual([1]);
        // The trend is placed in the first column, before the sales of the session order
        expect(cards('Visualizations')).toEqual([3, 2]);
        expect(card(1).style.gridColumn).toBe('1 / span 4');
        expect(card(2).style.gridColumn).toBe('7 / span 6');
        expect(card(2).style.gridRow).toBe('1 / span 3');

        // A new placement in the text of a script moves its card
        const moved = script(3, '3_trend.sql', { vis: { renderer: 'vegalite', spec: { row: 3, column: 0, width: 6, height: 3 } }, latestQueryId: 30 });
        render(session(SETUP, SALES, moved));
        // The layout follows the text in an effect
        await act(() => flushContinuousUpdates());
        expect(cards('Visualizations')).toEqual([2, 3]);
        expect(card(3).style.gridRow).toBe('4 / span 3');

        // Without visualizations, the section is gone
        render(session(SETUP));
        expect(section('Visualizations')).toBeNull();
    });

    it('runs, refreshes and stops the cards', () => {
        render(session(SETUP, SALES, TREND));
        const sessionScripts = runSessionScript.mock.calls;
        // A card without a result runs and may use the cache, a card with a result refreshes
        act(() => cardButton(1, 'dashboard-card-run').click());
        act(() => cardButton(2, 'dashboard-card-run').click());
        expect(sessionScripts.map(call => [call[1].scriptKey, call[5]])).toEqual([[1, { refresh: false }], [2, { refresh: true }]]);
        expect(sessionScripts[0][2]).toBe(executor.execute);
        expect(sessionScripts[0][3]).toBe(modify);

        // A running card cancels its query
        expect(cardButton(3, 'dashboard-card-run').getAttribute('data-run-action')).toBe('stop');
        act(() => cardButton(3, 'dashboard-card-run').click());
        expect(executor.cancel).toHaveBeenCalledWith('db', 30);

        // An offline connection runs nothing
        render(session(SETUP, SALES, TREND), { scriptConnections: new Map() });
        expect(cardButton(1, 'dashboard-card-run').disabled).toBe(true);
    });

    it('renames and deletes a card from its menu', async () => {
        const renameDraft = vi.fn();
        modify.mockImplementation(async (action: { type: symbol }) => action.type === RENAME_SCRIPT
            ? { scripts: { 2: { fileName: 'revenue.sql' } } }
            : null);
        render(session(SETUP, SALES, TREND), { draftRenameRef: { current: renameDraft } });

        const menuItem = (action: string) => document.querySelector<HTMLElement>(`[data-testid="dashboard-card-menu-item"][data-action="${action}"]`)!;
        act(() => cardButton(2, 'dashboard-card-more').click());
        act(() => menuItem('rename').click());
        await act(() => new Promise(resolve => requestAnimationFrame(() => resolve(null))));
        const input = card(2).querySelector<HTMLInputElement>('input[aria-label="Script name"]')!;
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'revenue');
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        expect(actions()).toEqual([{ type: RENAME_SCRIPT, value: { fileName: '2_sales.sql', newFileName: 'revenue' } }]);
        // The draft of the composer follows the name
        expect(renameDraft).toHaveBeenCalledWith('2_sales', 'revenue');

        act(() => cardButton(2, 'dashboard-card-more').click());
        act(() => menuItem('delete').click());
        expect(actions()[1]).toEqual({ type: DELETE_SCRIPT, value: '2_sales.sql' });
    });

    it('switches the renderers and opens the overlays of the cards', () => {
        render(session(SETUP, SALES, TREND));

        // A chart starts as a bar chart and opens the chart builder, its edits are staged
        act(() => cardButton(1, 'dashboard-card-renderer-chart').click());
        expect(actions()).toEqual([
            { type: SET_SCRIPT_TEXT, value: { scriptKey: 1, text: 'renderer 1 vegalite {"mark":"bar"}', withDiff: true } },
        ]);
        expect(testId('chart-overlay')!.getAttribute('data-script')).toBe('1_setup.sql');
        act(() => testId('chart-change')!.click());
        expect(actions()[1]).toEqual({ type: SET_SCRIPT_VIS_SPEC, value: { scriptKey: 1, spec: '{"mark":"line"}' } });
        act(() => testId('overlay-close')!.click());
        expect(testId('chart-overlay')).toBeNull();

        // Markdown starts with a template of the result columns and opens the editor
        modify.mockClear();
        act(() => cardButton(2, 'dashboard-card-renderer-markdown').click());
        expect(actions()).toEqual([
            { type: SET_SCRIPT_TEXT, value: { scriptKey: 2, text: 'renderer 0 markdown ### {{region}}\n{{revenue}}', withDiff: true } },
        ]);
        expect(testId('editor-overlay')!.getAttribute('data-script')).toBe('2_sales.sql');
        act(() => testId('editor-accept')!.click());
        act(() => testId('editor-reject')!.click());
        expect(actions().slice(1)).toEqual([{ type: ACCEPT_PENDING_DIFF, value: 2 }, { type: REJECT_PENDING_DIFF, value: 2 }]);
        act(() => testId('overlay-close')!.click());
        expect(testId('editor-overlay')).toBeNull();

        // A table opens no overlay, collapsing removes the renderer
        modify.mockClear();
        act(() => cardButton(3, 'dashboard-card-renderer-table').click());
        act(() => cardButton(2, 'dashboard-card-renderer-collapsed').click());
        expect(actions()).toEqual([
            { type: SET_SCRIPT_TEXT, value: { scriptKey: 3, text: 'renderer 0 table ', withDiff: true } },
            { type: SET_SCRIPT_TEXT, value: { scriptKey: 2, text: 'renderer 0 null ', withDiff: true } },
        ]);
        expect(testId('editor-overlay')).toBeNull();
        expect(testId('chart-overlay')).toBeNull();

        // The edit button, the chart builder and the table of a card open their overlays
        act(() => cardButton(3, 'dashboard-card-edit').click());
        expect(testId('editor-overlay')!.getAttribute('data-script')).toBe('3_trend.sql');
        act(() => cardButton(3, 'dashboard-card-chart-builder').click());
        expect(testId('editor-overlay')).toBeNull();
        expect(testId('chart-overlay')!.getAttribute('data-script')).toBe('3_trend.sql');
        act(() => cardButton(2, 'card-table').click());
        expect(testId('table-overlay')!.getAttribute('data-script')).toBe('2_sales.sql');
        act(() => testId('overlay-close')!.click());
        expect(testId('table-overlay')).toBeNull();
    });

    it('opens no overlay when the renderer cannot be written', () => {
        const broken = script(4, '4_broken.sql', { vis: { renderer: 'table' }, latestQueryId: 40 });
        state.queries.set(40, { queryId: 40, status: QueryExecutionStatus.SUCCEEDED, resultTable: { schema: { fields: [] } } });
        (broken.scriptSession as unknown as { rewriteVisRenderer: () => string }).rewriteVisRenderer = () => { throw new Error('cannot rewrite'); };
        render(session(broken));
        act(() => cardButton(4, 'dashboard-card-renderer-chart').click());
        expect(modify).not.toHaveBeenCalled();
        expect(testId('chart-overlay')).toBeNull();
    });

    it('accepts and rejects the staged change of a card', () => {
        const staged = script(2, '2_sales.sql', { vis: { renderer: 'table' }, latestQueryId: 20, pendingDiff: true });
        render(session(staged));
        act(() => cardButton(2, 'dashboard-card-accept').click());
        act(() => cardButton(2, 'dashboard-card-reject').click());
        expect(actions()).toEqual([{ type: ACCEPT_PENDING_DIFF, value: 2 }, { type: REJECT_PENDING_DIFF, value: 2 }]);
    });

    it('resizes a card with the keyboard and writes the placements that changed', () => {
        render(session(SETUP, SALES, TREND));
        expect(resizeHandle(3).getAttribute('aria-label')).toBe('Resize 3_trend. Current size 6 columns by 3 rows');
        act(() => resizeHandle(3).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
        // The wider trend pushes the sales below it
        expect(resizeHandle(3).getAttribute('aria-label')).toBe('Resize 3_trend. Current size 7 columns by 3 rows');
        expect(card(2).style.gridRow).toBe('4 / span 3');
        expect(card(2).style.gridColumn).toBe('1 / span 6');
        expect(actions()).toEqual([
            { type: SET_SCRIPT_TEXT, value: { scriptKey: 2, text: 'board 0 3 0 6 3', withDiff: false } },
            { type: SET_SCRIPT_TEXT, value: { scriptKey: 3, text: 'board 0 0 0 7 3', withDiff: false } },
        ]);

        // A collapsed card only changes its width
        modify.mockClear();
        act(() => resizeHandle(1).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
        expect(modify).not.toHaveBeenCalled();
        act(() => resizeHandle(1).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
        expect(actions()).toEqual([{ type: SET_SCRIPT_TEXT, value: { scriptKey: 1, text: 'board 1 0 0 3 1', withDiff: false } }]);
    });

    it('resizes a card with the pointer and restores the layout of a cancelled resize', async () => {
        render(session(SALES, TREND));
        const pointer = (target: EventTarget, type: string, x: number, y: number) => act(() => {
            target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1 }));
        });
        const rowStep = 40 + 12;
        const label = () => resizeHandle(2).getAttribute('aria-label');

        // Moving the pointer previews the size, a cancel restores it and writes nothing
        pointer(resizeHandle(2), 'pointerdown', 0, 0);
        pointer(window, 'pointermove', 0, 2 * rowStep);
        await act(() => flushContinuousUpdates());
        expect(label()).toBe('Resize 2_sales. Current size 6 columns by 5 rows');
        // Moves within the snapped size change nothing
        pointer(window, 'pointermove', 0, 2 * rowStep + 5);
        pointer(window, 'pointercancel', 0, 0);
        await act(() => flushContinuousUpdates());
        expect(label()).toBe('Resize 2_sales. Current size 6 columns by 3 rows');
        expect(modify).not.toHaveBeenCalled();

        // Releasing the pointer writes the size
        pointer(resizeHandle(2), 'pointerdown', 0, 0);
        pointer(window, 'pointermove', 0, rowStep);
        pointer(window, 'pointerup', 0, rowStep);
        await act(() => flushContinuousUpdates());
        expect(label()).toBe('Resize 2_sales. Current size 6 columns by 4 rows');
        expect(actions()).toEqual([{ type: SET_SCRIPT_TEXT, value: { scriptKey: 2, text: 'board 0 0 6 6 4', withDiff: false } }]);
    });

    it('moves a card with the keyboard and announces its new place', async () => {
        // The keyboard sensor scrolls instead of moving a card past the middle of the viewport, keep the board on top
        Object.assign(container.style, { position: 'fixed', top: '0', left: '0' });
        render(session(SALES, TREND));
        const handle = card(3).querySelector<HTMLButtonElement>('button[aria-label="Move 3_trend"]')!;
        const key = (target: EventTarget, code: string) => act(() => {
            target.dispatchEvent(new KeyboardEvent('keydown', { code, key: code === 'Space' ? ' ' : code, bubbles: true, cancelable: true }));
        });
        const frame = () => act(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null)))));
        handle.focus();
        key(handle, 'Space');
        await frame();
        // A step moves the trend by a row or a column, keys without a direction do nothing
        key(document, 'ArrowDown');
        await frame();
        key(document, 'ArrowRight');
        await frame();
        key(document, 'ArrowRight');
        await frame();
        key(document, 'ArrowLeft');
        await frame();
        key(document, 'ArrowUp');
        await frame();
        key(document, 'ArrowDown');
        await frame();
        key(document, 'KeyA');
        await frame();
        key(document, 'Space');
        await frame();
        expect(container.querySelector('[role="status"]')!.textContent).toBe('3_trend.sql moved to row 2, column 2');
        expect(card(3).style.gridRow).toBe('2 / span 3');
        expect(card(3).style.gridColumn).toBe('2 / span 6');
        // The sales make room for the trend
        expect(actions().map(action => action.value.scriptKey).sort()).toEqual([2, 3]);
        expect(actions()).toContainEqual({ type: SET_SCRIPT_TEXT, value: { scriptKey: 3, text: 'board 0 1 1 6 3', withDiff: false } });
    });
});
