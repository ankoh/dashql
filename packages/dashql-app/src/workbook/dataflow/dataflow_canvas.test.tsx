import * as React from 'react';
import type * as core from '@akohn/dashql';
import { act, flushContinuousUpdates } from '@akohn/dashql-react/testing/react_act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScriptDataMap, WorkbookScripts } from '@akohn/dashql/platform/workbook/workbook_scripts';
import type { ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import { DataflowCanvas, type DataflowCanvasDependencies, RESIZE_KEY_STEP } from './dataflow_canvas.js';
import { analyzedTestWorkbook, withTestScript, type TestWorkbook } from './dataflow_test_workbook.js';
import { loadDataflowModule } from './dataflow_module.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

let layout: core.DashQLDataflow;
beforeAll(async () => {
    layout = await loadDataflowModule();
});

/// The workbook of a test on a runtime, and the scripts that the canvas reads
let test: TestWorkbook;
let workbook: WorkbookScripts;
let scripts: ScriptDataMap;

/// Show a workbook of a test, its scripts are copies that a test may change
function show(next: TestWorkbook): void {
    test = next;
    workbook = next.workbook;
    scripts = { ...next.scripts };
}

/// The scripts of the tests run on no connection
const NO_CONNECTIONS: ReadonlyMap<string, ConnectionState> = new Map();

const dependencies: DataflowCanvasDependencies = {
    useQueryModel: () => null,
    VisualizationPanel: () => <div data-testid="chart" />,
    useDataflowModule: () => ({ layout, error: null }),
    // The header of the feed entry needs the connections and the storage of the app
    ScriptEntryHeader: ((props: React.ComponentProps<DataflowCanvasDependencies['ScriptEntryHeader']>) => (
        <div data-testid="entry-header" data-script={props.scriptKey}>
            <button data-testid="script-delete" onClick={() => props.onDelete!(scripts[props.scriptKey])} />
            {props.onEdit != null && <button data-testid="script-edit" onClick={props.onEdit} />}
        </div>
    )) as unknown as DataflowCanvasDependencies['ScriptEntryHeader'],
    useWorkbookScriptMap: () => scripts,
    useWorkbookDerived: () => test.derived,
};

describe('DataflowCanvas', () => {
    let container: HTMLDivElement;
    let root: Root;
    const modify = vi.fn();
    /// Forget the actions, every action applies
    const resetModify = () => {
        modify.mockReset();
        modify.mockReturnValue({ ok: true, changed: true, error: null, id: null });
    };

    beforeEach(async () => {
        container = document.createElement('div');
        container.style.width = '1000px';
        container.style.height = '600px';
        document.body.appendChild(container);
        root = createRoot(container);
        resetModify();
        show(await analyzedTestWorkbook([
            ['schema.sql', 'create table t (a int);\ninsert into t values (1)'],
            ['report.sql', 'select a from t'],
        ]));
    });
    afterEach(async () => {
        act(() => root.unmount());
        container.remove();
        await test.runtime.destroy();
    });

    const render = (onInspect?: (scriptKey: number) => void) => act(() => root.render(
        <DataflowCanvas workbookScripts={workbook} modifyWorkbookScripts={modify} scriptConnections={NO_CONNECTIONS} onInspect={onInspect} dependencies={dependencies} />,
    ));
    const key = (fileName: string) => workbook.scriptRefs[fileName].scriptId;
    const box = (fileName: string) => container.querySelector<SVGGElement>(`[data-dataflow-box="${key(fileName)}"]`)!;
    const ports = (fileName: string) => container.querySelector<SVGGElement>(`[data-dataflow-ports="${key(fileName)}"]`)!;

    it('waits for the layout module and tells when it failed to load', () => {
        const loading = { ...dependencies, useDataflowModule: () => ({ layout: null, error: null }) };
        act(() => root.render(<DataflowCanvas workbookScripts={workbook} modifyWorkbookScripts={modify} scriptConnections={NO_CONNECTIONS} dependencies={loading} />));
        expect(container.querySelector('[data-testid="dataflow-loading"]')).not.toBeNull();
        expect(container.querySelector('[data-dataflow-box]')).toBeNull();
        const failed = { ...dependencies, useDataflowModule: () => ({ layout: null, error: new Error('offline') }) };
        act(() => root.render(<DataflowCanvas workbookScripts={workbook} modifyWorkbookScripts={modify} scriptConnections={NO_CONNECTIONS} dependencies={failed} />));
        expect(container.querySelector('[data-testid="dataflow-loading"]')?.textContent).toContain('offline');
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
            if (action?.kind !== 'setScriptText') continue;
            const fileName = Object.keys(workbook.scriptRefs).find(f => key(f) === action.value.scriptKey)!;
            texts.set(fileName, action.value.text);
        }
        return texts;
    };
    const cardAt = (fileName: string) => {
        const frame = container.querySelectorAll('rect[data-dataflow-card]')[workbook.scriptOrder.indexOf(fileName)];
        return { x: Math.round(Number(frame.getAttribute('x'))), y: Math.round(Number(frame.getAttribute('y'))) };
    };
    const drag = (fileName: string, dx: number, dy: number) => {
        const header = box(fileName).querySelector<SVGGElement>('[data-dataflow-handle]')!;
        const pointer = (type: string, x: number, y: number) => new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX: x, clientY: y });
        act(() => { header.dispatchEvent(pointer('pointerdown', 100, 100)); });
        act(() => { header.dispatchEvent(pointer('pointermove', 100 + dx, 100 + dy)); });
        act(() => { header.dispatchEvent(pointer('pointerup', 100 + dx, 100 + dy)); });
    };

    it('fades what the selected box neither reads nor feeds', () => {
        show(withTestScript(test, 'other.sql', 'select 1'));
        render();
        drag('report.sql', 0, 0);
        expect(box('report.sql').getAttribute('data-selected')).toBe('true');
        expect(box('report.sql').hasAttribute('data-faded')).toBe(false);
        expect(box('schema.sql').hasAttribute('data-faded')).toBe(false);
        expect(box('other.sql').getAttribute('data-faded')).toBe('true');
        // The edges of the lineage are highlighted, the edge inside the box it reads as well
        expect(container.querySelectorAll('[data-dataflow-edge-highlight]').length).toBe(2);
        act(() => container.querySelector('svg')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        expect(container.querySelectorAll('[data-faded]').length).toBe(0);
    });

    it('draws the boxes as tiles when zoomed out so far that their text is too small', () => {
        render();
        const svg = container.querySelector('svg')!;
        const wheel = (deltaY: number) => act(() => { svg.dispatchEvent(new WheelEvent('wheel', { deltaY, ctrlKey: true, bubbles: true, cancelable: true, clientX: 100, clientY: 100 })); });
        // A pinch to half the size
        wheel(50);
        expect(container.querySelector('[data-dataflow-tiles="zoomed-out"]')).not.toBeNull();
        expect(container.querySelector('[data-dataflow-box]')).toBeNull();
        // The box of two rows has room for the text at its size on the screen
        const tile = container.querySelector(`[data-dataflow-tile="script:${key('schema.sql')}"]`)!;
        expect(tile.textContent).toContain('schema');
        // The text of a tile keeps its size on the screen, the canvas tells its scale
        const scale = Number((container.querySelector('svg > g') as SVGGElement).style.getPropertyValue('--dataflow_zoom'));
        expect(scale).toBeLessThan(0.6);
        expect(Number.parseFloat(getComputedStyle(tile.querySelector('text')!).fontSize)).toBeCloseTo(12 / scale, 0);
        wheel(-200);
        expect(container.querySelector('[data-dataflow-tiles]')).toBeNull();
        expect(box('report.sql')).not.toBeNull();
    });

    it('lays out tiles from top to bottom on a narrow canvas, a tap shows the lineage and nothing is saved', () => {
        container.style.width = '390px';
        container.style.height = '700px';
        show(withTestScript(test, 'other.sql', 'select 1'));
        render();
        expect(container.querySelector('[data-dataflow-tiles="dense"]')).not.toBeNull();
        expect(container.querySelector('[data-dataflow-box]')).toBeNull();
        const tile = (fileName: string) => container.querySelector<SVGGElement>(`[data-dataflow-tile="script:${key(fileName)}"]`)!;
        const frame = (fileName: string) => tile(fileName).querySelector('rect:not(clipPath rect)')!;
        const top = (fileName: string) => Number(frame(fileName).getAttribute('y'));
        expect(Number(frame('schema.sql').getAttribute('width'))).toBe(layout.config.tileWidth);
        expect(top('report.sql')).toBeGreaterThan(top('schema.sql') + layout.config.tileHeight);
        // One edge between the tiles, the edge inside the box is left out
        expect(container.querySelectorAll('[data-dataflow-edge]').length).toBe(1);
        act(() => tile('report.sql').dispatchEvent(new MouseEvent('click', { bubbles: true })));
        expect(tile('report.sql').getAttribute('data-selected')).toBe('true');
        expect(tile('other.sql').getAttribute('data-faded')).toBe('true');
        expect(tile('schema.sql').hasAttribute('data-faded')).toBe(false);
        expect(container.querySelectorAll('[data-dataflow-edge-highlight]').length).toBe(1);
        // The dense layout writes no positions
        expect(written().size).toBe(0);
    });

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

    it('shows the same layout after a reload of the saved scripts', async () => {
        render();
        drag('report.sql', 0, 160);
        const shown = { schema: cardAt('schema.sql'), report: cardAt('report.sql') };
        const texts = written();
        act(() => root.unmount());
        root = createRoot(container);
        await test.runtime.destroy();
        show(await analyzedTestWorkbook([
            ['schema.sql', texts.get('schema.sql')!],
            ['report.sql', texts.get('report.sql')!],
        ]));
        // The workbook reads the tags into the annotations of the scripts
        for (const fileName of ['schema.sql', 'report.sql']) {
            const [, x, y] = texts.get(fileName)!.match(/@flow x=(-?\d+) y=(-?\d+)/)!;
            const script = scripts[key(fileName)];
            scripts[key(fileName)] = { ...script, annotations: { ...script.annotations, flowPosition: { statementId: 0, x: Number(x), y: Number(y), width: null, height: null } } };
        }
        resetModify();
        render();
        expect({ schema: cardAt('schema.sql'), report: cardAt('report.sql') }).toEqual(shown);
        // Nothing to save, the tags hold the layout
        expect(modify).not.toHaveBeenCalled();
    });

    it('keeps the boxes in place and places a new script right of the box it reads, in a free slot', () => {
        render();
        const rect = (fileName: string) => {
            const frame = container.querySelectorAll('rect[data-dataflow-card]')[workbook.scriptOrder.indexOf(fileName)];
            return { x: Number(frame.getAttribute('x')), y: Number(frame.getAttribute('y')) };
        };
        const before = { schema: rect('schema.sql'), report: rect('report.sql') };
        show(withTestScript(test, 'first.sql', 'select * from :report'));
        render();
        show(withTestScript(test, 'second.sql', 'select * from :report'));
        render();
        expect([rect('schema.sql').x, rect('schema.sql').y]).toEqual([before.schema.x, before.schema.y]);
        expect([rect('report.sql').x, rect('report.sql').y]).toEqual([before.report.x, before.report.y]);
        const [first, second] = [rect('first.sql'), rect('second.sql')];
        expect(first.x).toBeGreaterThan(before.report.x);
        expect(second.x).toBe(first.x);
        expect(second.y).not.toBe(first.y);
    });

    it('moves a requested box into view above the prompt', async () => {
        render();
        // A script far away from the boxes that the canvas fitted
        show(withTestScript(test, 'far.sql', '/** @flow x=4000 y=3000 */\nselect a from t'));
        const request = { scriptKey: key('far.sql') };
        const bottomInset = () => 150;
        act(() => root.render(
            <DataflowCanvas workbookScripts={workbook} modifyWorkbookScripts={modify} scriptConnections={NO_CONNECTIONS} revealRequest={request} bottomInset={bottomInset} dependencies={dependencies} />,
        ));
        const frame = () => container.querySelector<SVGRectElement>(`rect[data-dataflow-card="${key('far.sql')}"]`)!;
        expect(frame().getAttribute('data-selected')).toBe('false');
        const viewport = container.querySelector<HTMLElement>('[data-testid="dataflow-canvas"]')!.getBoundingClientRect();
        await vi.waitFor(() => {
            const rect = frame().getBoundingClientRect();
            expect(rect.left).toBeGreaterThanOrEqual(viewport.left);
            expect(rect.right).toBeLessThanOrEqual(viewport.right);
            expect(rect.top).toBeGreaterThanOrEqual(viewport.top);
            expect(rect.bottom).toBeLessThanOrEqual(viewport.bottom - 150 + 1);
        });
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
        expect(create?.kind).toBe('createScript');
        // The layout places the new script right of the box, it has no position of its own
        expect(create?.value.text).toBe('select * from :report');
        expect(create?.value.connectionId).toBe(scripts[key('report.sql')].connectionId);

        act(() => box('report.sql').querySelector<HTMLButtonElement>('[data-testid="script-edit"]')!.click());
        expect(onInspect).toHaveBeenCalledWith(key('report.sql'));

        act(() => box('report.sql').querySelector<HTMLButtonElement>('[data-testid="script-delete"]')!.click());
        expect(modify.mock.calls[modify.mock.calls.length - 1]?.[0]).toEqual({ kind: 'deleteScript', value: { fileName: 'report.sql' } });
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
        const report = scripts[key('report.sql')];
        scripts[key('report.sql')] = { ...report, annotations: { ...report.annotations, flowPosition: { statementId: 0, x: 800, y: 400, width: 400, height: null } } };
        render();
        act(() => container.querySelector<HTMLButtonElement>('[data-testid="dataflow-arrange"]')!.click());
        // The script with a tag loses its position, the other one has none
        const rewritten = modify.mock.calls.map(call => call[0]).filter(action => action.kind === 'setScriptText');
        expect(rewritten.map(action => [action.value.scriptKey, action.value.text])).toEqual([[key('report.sql'), '/** @flow width=400 */\nselect a from t']]);
    });

    it('resizes a box by the handle in its bottom right corner and writes the width into its @flow tag', () => {
        render();
        const card = () => container.querySelectorAll('rect[data-dataflow-card]')[workbook.scriptOrder.indexOf('report.sql')];
        const handle = box('report.sql').querySelector<SVGGElement>('[data-dataflow-resize]')!;
        const pointer = (type: string, x: number, y: number) => new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX: x, clientY: y });
        const { boxWidth, grid } = layout.config;
        expect(card().getAttribute('width')).toBe(`${boxWidth}`);
        // A move a bit beyond five grid steps
        const wider = boxWidth + 5 * grid;
        const x = 500 + wider - boxWidth + 1;
        act(() => { handle.dispatchEvent(pointer('pointerdown', 500, 500)); });
        act(() => { handle.dispatchEvent(pointer('pointermove', x, 540)); });
        // The box follows the pointer on the grid, a box without a chart only changes its width
        expect(card().getAttribute('width')).toBe(`${wider}`);
        expect(box('report.sql').getAttribute('data-resizing')).toBe('true');
        expect(modify).not.toHaveBeenCalled();
        act(() => { handle.dispatchEvent(pointer('pointerup', x, 540)); });
        // Every box is saved, the resized one with its width
        expect(written().get('report.sql')).toMatch(new RegExp(`^/\\*\\* @flow x=-?\\d+ y=-?\\d+ width=${wider} \\*/\nselect a from t$`));
        expect(written().get('schema.sql')).toMatch(/@flow x=-?\d+ y=-?\d+ \*\//);
        expect(box('report.sql').getAttribute('data-resizing')).toBeNull();
    });

    it('resizes a box with the arrow keys and keeps the y of its @flow tag', () => {
        const report = { ...scripts[key('report.sql')] };
        report.annotations = { ...report.annotations, flowPosition: { statementId: 0, x: 800, y: 400, width: null, height: null } };
        scripts[key('report.sql')] = report;
        render();
        const handle = box('report.sql').querySelector<SVGGElement>('[data-dataflow-resize]')!;
        act(() => { handle.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' })); });
        const width = layout.config.boxWidth + RESIZE_KEY_STEP;
        expect(written().get('report.sql')).toMatch(new RegExp(`^/\\*\\* @flow x=-?\\d+ y=400 width=${width} \\*/\nselect a from t$`));
        // Narrower than the smallest box, the width stays at its bound
        resetModify();
        const narrow = { ...report, annotations: { ...report.annotations, flowPosition: { statementId: 0, x: 800, y: 400, width: 200, height: null } } };
        scripts = { ...scripts, [key('report.sql')]: narrow };
        render();
        const narrowHandle = box('report.sql').querySelector<SVGGElement>('[data-dataflow-resize]')!;
        act(() => { narrowHandle.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowLeft' })); });
        expect(modify).not.toHaveBeenCalled();
    });
});
