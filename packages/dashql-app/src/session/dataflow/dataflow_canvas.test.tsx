import * as React from 'react';
import * as core from '@ankoh/dashql-core';
import { act, flushContinuousUpdates } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CREATE_SCRIPT,DELETE_SCRIPT, SET_SCRIPT_TEXT, type SessionScripts } from '../scripts/session_scripts.js';
import { DataflowCanvas, type DataflowCanvasDependencies } from './dataflow_canvas.js';
import { analyzedTestSession, withTestScript } from './dataflow_test_session.js';
import { loadDataflowModule } from './dataflow_module.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

let dql: core.DashQL;
let layout: core.DashQLDataflow;
beforeAll(async () => {
    dql = await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
    layout = await loadDataflowModule();
});

const dependencies: DataflowCanvasDependencies = {
    useQueryState: () => null,
    VisualizationPanel: () => <div data-testid="chart" />,
    useDataflowModule: () => ({ layout, error: null }),
    // The header of the feed entry needs the connections and the storage of the app
    ScriptEntryHeader: ((props: any) => (
        <div data-testid="entry-header" data-script={props.scriptKey}>
            <button data-testid="script-delete" onClick={() => props.onDelete(props.sessionScripts.scripts[props.scriptKey])} />
            {props.onEdit != null && <button data-testid="script-edit" onClick={props.onEdit} />}
        </div>
    )) as unknown as DataflowCanvasDependencies['ScriptEntryHeader'],
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

    it('waits for the layout module and tells when it failed to load', () => {
        const loading = { ...dependencies, useDataflowModule: () => ({ layout: null, error: null }) };
        act(() => root.render(<DataflowCanvas sessionScripts={session} modifySessionScripts={modify} dependencies={loading} />));
        expect(container.querySelector('[data-testid="dataflow-loading"]')?.textContent).toBe('Loading Eclipse Layout Kernel…');
        expect(container.querySelector('[data-dataflow-box]')).toBeNull();
        const failed = { ...dependencies, useDataflowModule: () => ({ layout: null, error: new Error('offline') }) };
        act(() => root.render(<DataflowCanvas sessionScripts={session} modifySessionScripts={modify} dependencies={failed} />));
        expect(container.querySelector('[data-testid="dataflow-loading"]')?.textContent).toBe('Eclipse Layout Kernel failed to load: offline');
    });

    it('zooms the canvas instead of the page on a pinch', () => {
        render();
        const wheel = (target: Element, ctrlKey: boolean) => {
            const event = new WheelEvent('wheel', { deltaY: -40, ctrlKey, bubbles: true, cancelable: true, clientX: 100, clientY: 100 });
            act(() => { target.dispatchEvent(event); });
            return event.defaultPrevented;
        };
        // A pinch anywhere on the page is kept from the page, a scroll is not
        expect(wheel(document.body, true)).toBe(true);
        expect(wheel(document.body, false)).toBe(false);
        // A pinch over a statement zooms the canvas, a scroll over it does not
        const scene = container.querySelector('svg > g')!;
        const statement = box('report.sql').querySelector('[data-dataflow-statement]')!;
        const before = scene.getAttribute('transform');
        expect(wheel(statement, false)).toBe(false);
        expect(scene.getAttribute('transform')).toBe(before);
        expect(wheel(statement, true)).toBe(true);
        expect(scene.getAttribute('transform')).not.toBe(before);
        // The page zooms again once the canvas is closed
        act(() => root.unmount());
        root = createRoot(container);
        expect(wheel(document.body, true)).toBe(false);
    });

    it('draws a box per script with its statements and the edges between them', () => {
        render();
        expect(box('schema.sql')).not.toBeNull();
        expect(box('report.sql')).not.toBeNull();
        expect(box('schema.sql').querySelectorAll('[data-dataflow-statement]').length).toBe(2);
        const edges = [...container.querySelectorAll('[data-dataflow-edge]')].map(e => e.getAttribute('data-kind'));
        expect(edges).toEqual(['table', 'table']);
        expect([...container.querySelectorAll('[data-dataflow-badge] text')].map(t => t.textContent)).toEqual(['t']);
    });

    it('draws the edges on the outlines of the boxes and below their statements', () => {
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
        expect(precedes(card, between[0])).toBe(true);
        expect(precedes(card, badge)).toBe(true);
        expect(precedes(card, inside[0])).toBe(true);
        expect(precedes(between[0], box('report.sql'))).toBe(true);
        expect(precedes(inside[0], box('report.sql'))).toBe(true);
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
            await flushContinuousUpdates();
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

    /// The texts that the canvas wrote into the scripts, by file name
    const written = () => {
        const texts = new Map<string, string>();
        for (const [action] of modify.mock.calls) {
            if (action?.type !== SET_SCRIPT_TEXT) continue;
            const fileName = Object.keys(session.scriptRefs).find(f => key(f) === action.value.scriptKey)!;
            texts.set(fileName, action.value.text);
        }
        return texts;
    };
    const cardAt = (fileName: string) => {
        const frame = container.querySelectorAll('rect[data-dataflow-card]')[session.scriptOrder.indexOf(fileName)];
        return { x: Math.round(Number(frame.getAttribute('x'))), y: Math.round(Number(frame.getAttribute('y'))) };
    };
    const drag = (fileName: string, dx: number, dy: number) => {
        const header = box(fileName).querySelector<SVGGElement>('[data-dataflow-handle]')!;
        const pointer = (type: string, x: number, y: number) => new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX: x, clientY: y });
        act(() => { header.dispatchEvent(pointer('pointerdown', 100, 100)); });
        act(() => { header.dispatchEvent(pointer('pointermove', 100 + dx, 100 + dy)); });
        act(() => { header.dispatchEvent(pointer('pointerup', 100 + dx, 100 + dy)); });
    };

    it('saves every box into its @flow tag after a drop', () => {
        render();
        const before = cardAt('report.sql');
        drag('report.sql', 0, 160);
        // The dropped box keeps its column and takes the y of the drop
        expect(cardAt('report.sql').x).toBe(before.x);
        expect(cardAt('report.sql').y).toBeGreaterThan(before.y);
        const texts = written();
        expect(texts.get('report.sql')).toMatch(/^\/\*\* @flow x=-?\d+ y=-?\d+ \*\/\nselect a from t$/);
        expect(texts.get('schema.sql')).toMatch(/\/\*\* @flow x=-?\d+ y=-?\d+ \*\//);
    });

    it('shows the same layout after a reload of the saved scripts', () => {
        render();
        drag('report.sql', 0, 160);
        const shown = { schema: cardAt('schema.sql'), report: cardAt('report.sql') };
        const texts = written();
        act(() => root.unmount());
        root = createRoot(container);
        session = analyzedTestSession(dql, [
            ['schema.sql', texts.get('schema.sql')!],
            ['report.sql', texts.get('report.sql')!],
        ]);
        // The session reads the tags into the annotations of the scripts
        for (const fileName of ['schema.sql', 'report.sql']) {
            const [, x, y] = texts.get(fileName)!.match(/@flow x=(-?\d+) y=(-?\d+)/)!;
            const script = session.scripts[key(fileName)];
            script.annotations = { ...script.annotations, flowPosition: { statementId: 0, x: Number(x), y: Number(y), width: null, height: null } };
        }
        modify.mockReset();
        render();
        expect({ schema: cardAt('schema.sql'), report: cardAt('report.sql') }).toEqual(shown);
        // Nothing to save, the tags hold the layout
        expect(modify).not.toHaveBeenCalled();
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
        expect(written().get('report.sql')).toMatch(/^\/\*\* @flow /);
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

        act(() => box('report.sql').querySelector<HTMLButtonElement>('[data-testid="script-edit"]')!.click());
        expect(onInspect).toHaveBeenCalledWith(key('report.sql'));

        act(() => box('report.sql').querySelector<HTMLButtonElement>('[data-testid="script-delete"]')!.click());
        expect(modify.mock.calls[modify.mock.calls.length - 1]?.[0]).toEqual({ type: DELETE_SCRIPT, value: 'report.sql' });
    });

    it('shows the header of the feed entry in a box, a drag on its free space moves the box', () => {
        const onInspect = vi.fn();
        render(onInspect);
        const header = box('report.sql').querySelector<HTMLDivElement>(`[data-dataflow-header="${key('report.sql')}"]`)!;
        expect(header.querySelector('[data-testid="entry-header"]')?.getAttribute('data-script')).toBe(String(key('report.sql')));
        const pointer = (type: string, x: number, y: number) => new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX: x, clientY: y });
        // A control of the header does not drag
        const control = header.querySelector<HTMLButtonElement>('[data-testid="script-delete"]')!;
        act(() => { control.dispatchEvent(pointer('pointerdown', 100, 100)); });
        act(() => { control.dispatchEvent(pointer('pointermove', 100, 260)); });
        expect(box('report.sql').getAttribute('data-dragging')).toBeNull();
        act(() => { control.dispatchEvent(pointer('pointerup', 100, 260)); });
        expect(written().size).toBe(0);
        // The free space of the header does
        const before = cardAt('report.sql');
        act(() => { header.dispatchEvent(pointer('pointerdown', 100, 100)); });
        act(() => { header.dispatchEvent(pointer('pointermove', 100, 260)); });
        expect(box('report.sql').getAttribute('data-dragging')).toBe('true');
        act(() => { header.dispatchEvent(pointer('pointerup', 100, 260)); });
        expect(cardAt('report.sql').y).toBeGreaterThan(before.y);
        expect(written().get('report.sql')).toMatch(/^\/\*\* @flow /);
        // A double click on it opens the script, on a control it does not
        act(() => { control.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
        expect(onInspect).not.toHaveBeenCalled();
        act(() => { header.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
        expect(onInspect).toHaveBeenCalledExactlyOnceWith(key('report.sql'));
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
        // Every box is saved, the resized one with its width
        expect(written().get('report.sql')).toMatch(/^\/\*\* @flow x=-?\d+ y=-?\d+ width=360 \*\/\nselect a from t$/);
        expect(written().get('schema.sql')).toMatch(/@flow x=-?\d+ y=-?\d+ \*\//);
        expect(box('report.sql').getAttribute('data-resizing')).toBeNull();
    });

    it('resizes a box with the arrow keys and keeps the y of its @flow tag', () => {
        const report = session.scripts[key('report.sql')];
        report.annotations = { ...report.annotations, flowPosition: { statementId: 0, x: 800, y: 400, width: null, height: null } };
        render();
        const handle = box('report.sql').querySelector<SVGGElement>('[data-dataflow-resize]')!;
        act(() => { handle.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' })); });
        expect(written().get('report.sql')).toMatch(/^\/\*\* @flow x=-?\d+ y=400 width=296 \*\/\nselect a from t$/);
        // Narrower than the smallest box, the width stays at its bound
        modify.mockReset();
        const narrow = { ...report, annotations: { ...report.annotations, flowPosition: { statementId: 0, x: 800, y: 400, width: 200, height: null } } };
        session = { ...session, scripts: { ...session.scripts, [key('report.sql')]: narrow } };
        render();
        const narrowHandle = box('report.sql').querySelector<SVGGElement>('[data-dataflow-resize]')!;
        act(() => { narrowHandle.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowLeft' })); });
        expect(modify).not.toHaveBeenCalled();
    });
});
