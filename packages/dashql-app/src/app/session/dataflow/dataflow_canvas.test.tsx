import * as React from 'react';
import * as core from '@ankoh/dashql-core';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { CREATE_SCRIPT, DELETE_SCRIPT, SET_SCRIPT_TEXT, type SessionScripts } from '../scripts/session_scripts.js';
import { DataflowCanvas, type DataflowCanvasDependencies } from './dataflow_canvas.js';
import { analyzedTestSession } from './dataflow_test_session.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

let dql: core.DashQL;
beforeAll(async () => { dql = await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });

const dependencies: DataflowCanvasDependencies = {
    useQueryState: () => null,
    VisualizationDispatch: () => <div data-testid="chart" />,
};

describe('DataflowCanvas', () => {
    let container: HTMLDivElement;
    let root: Root;
    let session: SessionScripts;
    const modify = vi.fn();

    beforeEach(() => {
        container = document.createElement('div');
        container.style.width = '1000px';
        container.style.height = '600px';
        document.body.appendChild(container);
        root = createRoot(container);
        modify.mockReset();
        session = analyzedTestSession(dql, [
            ['schema.sql', 'create table t (a int);\ninsert into t values (1)'],
            ['report.sql', 'select a from t'],
        ]);
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        dql.resetUnsafe();
    });

    const render = (onInspect?: (scriptKey: number) => void) => act(() => root.render(
        <DataflowCanvas sessionScripts={session} modifySessionScripts={modify} onInspect={onInspect} dependencies={dependencies} />,
    ));
    const key = (fileName: string) => session.scriptRefs[fileName].scriptId;
    const box = (fileName: string) => container.querySelector<SVGGElement>(`[data-dataflow-box="${key(fileName)}"]`)!;

    it('draws a box per script with its statements and the edges between them', () => {
        render();
        expect(box('schema.sql')).not.toBeNull();
        expect(box('report.sql')).not.toBeNull();
        expect(box('schema.sql').querySelectorAll('[data-dataflow-statement]').length).toBe(2);
        const edges = [...container.querySelectorAll('[data-dataflow-edge]')].map(e => e.getAttribute('data-kind'));
        expect(edges).toEqual(['table', 'table']);
        expect([...container.querySelectorAll('[data-dataflow-badge] text')].map(t => t.textContent)).toEqual(['t']);
    });

    it('highlights the edges of a selected statement', () => {
        render();
        const insert = box('schema.sql').querySelectorAll<SVGGElement>('[data-dataflow-statement]')[1];
        act(() => insert.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        expect(insert.getAttribute('data-selected')).toBe('true');
        expect(container.querySelectorAll('[data-dataflow-edge-highlight]').length).toBe(2);
        expect(box('report.sql').querySelector('[data-dataflow-port="input"]')?.getAttribute('data-highlighted')).toBe('true');
    });

    it('writes the position of a dragged box into its @vis flow tag', () => {
        render();
        const header = box('report.sql').querySelector<SVGGElement>('[data-dataflow-handle]')!;
        const pointer = (type: string, x: number, y: number) => new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX: x, clientY: y });
        act(() => { header.dispatchEvent(pointer('pointerdown', 100, 100)); });
        act(() => { header.dispatchEvent(pointer('pointermove', 180, 140)); });
        act(() => { header.dispatchEvent(pointer('pointerup', 180, 140)); });
        const action = modify.mock.calls[modify.mock.calls.length - 1]?.[0];
        expect(action?.type).toBe(SET_SCRIPT_TEXT);
        expect(action?.value.scriptKey).toBe(key('report.sql'));
        expect(action?.value.text).toMatch(/^\/\*\* @vis flow x=-?\d+ y=-?\d+ \*\/\nselect a from t$/);
    });

    it('adds a script that reads a box, deletes a box and opens a script', () => {
        const onInspect = vi.fn();
        render(onInspect);
        act(() => box('report.sql').querySelector<SVGGElement>('[data-dataflow-action="add"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        const create = modify.mock.calls[modify.mock.calls.length - 1]?.[0];
        expect(create?.type).toBe(CREATE_SCRIPT);
        expect(create?.value.text).toMatch(/^\/\*\* @vis flow x=\d+ y=-?\d+ \*\/\nselect \* from :report$/);
        expect(create?.value.connection).toBe(session.scripts[key('report.sql')].connection);

        act(() => box('report.sql').querySelector<SVGGElement>('[data-dataflow-action="open"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        expect(onInspect).toHaveBeenCalledWith(key('report.sql'));

        act(() => box('report.sql').querySelector<SVGGElement>('[data-dataflow-action="delete"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        expect(modify.mock.calls[modify.mock.calls.length - 1]?.[0]).toEqual({ type: DELETE_SCRIPT, value: 'report.sql' });
    });

    it('arranges the boxes again without their @vis flow tags', () => {
        const report = session.scripts[key('report.sql')];
        report.annotations = { ...report.annotations, flowPosition: { statementId: 0, x: 800, y: 400 } };
        render();
        act(() => container.querySelector<HTMLButtonElement>('[data-testid="dataflow-arrange"]')!.click());
        // The script with a tag loses it, the other one has none
        const removed = modify.mock.calls.map(call => call[0]).filter(action => action.type === SET_SCRIPT_TEXT);
        expect(removed.map(action => action.value.scriptKey)).toEqual([key('report.sql')]);
    });

    it('collapses a box to its header', () => {
        render();
        expect(box('schema.sql').querySelectorAll('[data-dataflow-statement]').length).toBe(2);
        act(() => box('schema.sql').querySelector<SVGGElement>('[data-dataflow-action="collapse"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        expect(box('schema.sql').querySelectorAll('[data-dataflow-statement]').length).toBe(0);
        // The edge inside the box is gone, the edge between the boxes stays
        expect(container.querySelectorAll('[data-dataflow-edge]').length).toBe(1);
    });
});
