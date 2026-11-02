import * as React from 'react';
import * as core from '@ankoh/dashql-core';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { CREATE_SCRIPT, DELETE_SCRIPT, SET_SCRIPT_TEXT, type SessionScripts } from '../scripts/session_scripts.js';
import { DataflowCanvas, type DataflowCanvasDependencies } from './dataflow_canvas.js';
import { analyzedTestSession, withTestScript } from './dataflow_test_session.js';

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
    const ports = (fileName: string) => container.querySelector<SVGGElement>(`[data-dataflow-ports="${key(fileName)}"]`)!;

    it('draws a box per script with its statements and the edges between them', () => {
        render();
        expect(box('schema.sql')).not.toBeNull();
        expect(box('report.sql')).not.toBeNull();
        expect(box('schema.sql').querySelectorAll('[data-dataflow-statement]').length).toBe(2);
        const edges = [...container.querySelectorAll('[data-dataflow-edge]')].map(e => e.getAttribute('data-kind'));
        expect(edges).toEqual(['table', 'table']);
        expect([...container.querySelectorAll('[data-dataflow-badge] text')].map(t => t.textContent)).toEqual(['t']);
    });

    it('draws the edges between boxes behind the cards and the edges inside a box on its card', () => {
        render();
        const card = container.querySelector('rect[data-dataflow-card]')!;
        const precedes = (a: Node, b: Node) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
        // The report reads the table from the other box, the edge with the badge, the insert reads it in its own box
        const badge = container.querySelector('[data-dataflow-badge]')!;
        const betweenKey = badge.getAttribute('data-dataflow-badge')!;
        const edges = [...container.querySelectorAll('[data-dataflow-edge]')];
        const between = edges.filter(e => e.getAttribute('data-dataflow-edge') === betweenKey);
        const inside = edges.filter(e => e.getAttribute('data-dataflow-edge') !== betweenKey);
        expect([between.length, inside.length]).toEqual([1, 1]);
        expect(precedes(between[0], card)).toBe(true);
        expect(precedes(badge, card)).toBe(true);
        expect(precedes(card, inside[0])).toBe(true);
    });

    it('highlights the edges of a hovered box on top of the boxes', async () => {
        render();
        const report = box('report.sql');
        const svg = container.querySelector('svg')!;
        const hit = report.querySelector('rect')!;
        // React derives enter and leave from the out event of the element the pointer leaves. A pointer event is
        // continuous, React renders its update in a task of its own.
        const move = async (from: Element, to: Element) => act(async () => {
            from.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerId: 1, relatedTarget: to }));
            await new Promise(resolve => setTimeout(resolve, 0));
        });
        await move(svg, hit);
        const highlights = [...container.querySelectorAll('[data-dataflow-edge-highlight]')];
        expect(highlights.length).toBe(1);
        expect(report.compareDocumentPosition(highlights[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(container.querySelector('[data-dataflow-highlight-layer] [data-dataflow-badge]')?.getAttribute('data-highlighted')).toBe('true');
        // The ports are drawn on top of the highlighted edges
        const port = ports('report.sql').querySelector('[data-dataflow-port="input"]')!;
        expect(port.getAttribute('data-highlighted')).toBe('true');
        expect(highlights[0].compareDocumentPosition(port) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        await move(hit, svg);
        expect(container.querySelectorAll('[data-dataflow-edge-highlight]').length).toBe(0);
        expect(container.querySelectorAll('[data-dataflow-badge]').length).toBe(1);
    });

    it('highlights the edges of a selected statement', () => {
        render();
        const insert = box('schema.sql').querySelectorAll<SVGGElement>('[data-dataflow-statement]')[1];
        act(() => insert.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        expect(insert.getAttribute('data-selected')).toBe('true');
        expect(container.querySelectorAll('[data-dataflow-edge-highlight]').length).toBe(2);
        expect(ports('report.sql').querySelector('[data-dataflow-port="input"]')?.getAttribute('data-highlighted')).toBe('true');
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
        expect(action?.value.text).toMatch(/^\/\*\* @flow x=-?\d+ y=-?\d+ \*\/\nselect a from t$/);
    });

    it('keeps the boxes in place and places a new script right of the box it reads, in a free slot', () => {
        render();
        const rect = (fileName: string) => {
            const frame = container.querySelectorAll('rect[data-dataflow-card]')[session.scriptOrder.indexOf(fileName)];
            return { x: Number(frame.getAttribute('x')), y: Number(frame.getAttribute('y')) };
        };
        const before = { schema: rect('schema.sql'), report: rect('report.sql') };
        session = withTestScript(session, 'first.sql', 'select * from :report');
        render();
        session = withTestScript(session, 'second.sql', 'select * from :report');
        render();
        expect([rect('schema.sql').x, rect('schema.sql').y]).toEqual([before.schema.x, before.schema.y]);
        expect([rect('report.sql').x, rect('report.sql').y]).toEqual([before.report.x, before.report.y]);
        const [first, second] = [rect('first.sql'), rect('second.sql')];
        expect(first.x).toBeGreaterThan(before.report.x);
        expect(second.x).toBe(first.x);
        expect(second.y).not.toBe(first.y);
    });

    it('drops a box at the last position of a fast drag', () => {
        render();
        const header = box('report.sql').querySelector<SVGGElement>('[data-dataflow-handle]')!;
        const pointer = (type: string, x: number, y: number) => new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX: x, clientY: y });
        // The release follows the move before React renders the drag
        act(() => {
            header.dispatchEvent(pointer('pointerdown', 100, 100));
            header.dispatchEvent(pointer('pointermove', 180, 140));
            header.dispatchEvent(pointer('pointerup', 180, 140));
        });
        const action = modify.mock.calls[modify.mock.calls.length - 1]?.[0];
        expect(action?.type).toBe(SET_SCRIPT_TEXT);
        expect(box('report.sql').getAttribute('data-dragging')).toBeNull();
    });

    it('adds a script that reads a box, deletes a box and opens a script', () => {
        const onInspect = vi.fn();
        render(onInspect);
        act(() => box('report.sql').querySelector<SVGGElement>('[data-dataflow-action="add"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        const create = modify.mock.calls[modify.mock.calls.length - 1]?.[0];
        expect(create?.type).toBe(CREATE_SCRIPT);
        // The layout places the new script right of the box, it has no position of its own
        expect(create?.value.text).toBe('select * from :report');
        expect(create?.value.connection).toBe(session.scripts[key('report.sql')].connection);

        act(() => box('report.sql').querySelector<SVGGElement>('[data-dataflow-action="open"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        expect(onInspect).toHaveBeenCalledWith(key('report.sql'));

        act(() => box('report.sql').querySelector<SVGGElement>('[data-dataflow-action="delete"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        expect(modify.mock.calls[modify.mock.calls.length - 1]?.[0]).toEqual({ type: DELETE_SCRIPT, value: 'report.sql' });
    });

    it('arranges the boxes again without the positions of their @flow tags, the sizes stay', () => {
        const report = session.scripts[key('report.sql')];
        report.annotations = { ...report.annotations, flowPosition: { statementId: 0, x: 800, y: 400, width: 400, height: null } };
        render();
        act(() => container.querySelector<HTMLButtonElement>('[data-testid="dataflow-arrange"]')!.click());
        // The script with a tag loses its position, the other one has none
        const rewritten = modify.mock.calls.map(call => call[0]).filter(action => action.type === SET_SCRIPT_TEXT);
        expect(rewritten.map(action => [action.value.scriptKey, action.value.text])).toEqual([[key('report.sql'), '/** @flow width=400 */\nselect a from t']]);
    });

    it('resizes a box by the handle in its bottom right corner and writes the width into its @flow tag', () => {
        render();
        const card = () => container.querySelectorAll('rect[data-dataflow-card]')[session.scriptOrder.indexOf('report.sql')];
        const handle = box('report.sql').querySelector<SVGGElement>('[data-dataflow-resize]')!;
        const pointer = (type: string, x: number, y: number) => new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX: x, clientY: y });
        expect(card().getAttribute('width')).toBe('280');
        act(() => { handle.dispatchEvent(pointer('pointerdown', 500, 500)); });
        act(() => { handle.dispatchEvent(pointer('pointermove', 581, 540)); });
        // The box follows the pointer on the grid, a box without a chart only changes its width
        expect(card().getAttribute('width')).toBe('360');
        expect(box('report.sql').getAttribute('data-resizing')).toBe('true');
        expect(modify).not.toHaveBeenCalled();
        act(() => { handle.dispatchEvent(pointer('pointerup', 581, 540)); });
        const action = modify.mock.calls[modify.mock.calls.length - 1]?.[0];
        expect([action?.type, action?.value.scriptKey, action?.value.text]).toEqual([SET_SCRIPT_TEXT, key('report.sql'), '/** @flow width=360 */\nselect a from t']);
        expect(box('report.sql').getAttribute('data-resizing')).toBeNull();
    });

    it('resizes a box with the arrow keys and keeps the position of its @flow tag', () => {
        const report = session.scripts[key('report.sql')];
        report.annotations = { ...report.annotations, flowPosition: { statementId: 0, x: 800, y: 400, width: null, height: null } };
        render();
        const handle = box('report.sql').querySelector<SVGGElement>('[data-dataflow-resize]')!;
        act(() => { handle.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' })); });
        const action = modify.mock.calls[modify.mock.calls.length - 1]?.[0];
        expect(action?.value.text).toBe('/** @flow x=800 y=400 width=296 */\nselect a from t');
        // Narrower than the smallest box, the width stays at its bound
        modify.mockReset();
        const narrow = { ...report, annotations: { ...report.annotations, flowPosition: { statementId: 0, x: 800, y: 400, width: 200, height: null } } };
        session = { ...session, scripts: { ...session.scripts, [key('report.sql')]: narrow } };
        render();
        const narrowHandle = box('report.sql').querySelector<SVGGElement>('[data-dataflow-resize]')!;
        act(() => { narrowHandle.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowLeft' })); });
        expect(modify).not.toHaveBeenCalled();
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
