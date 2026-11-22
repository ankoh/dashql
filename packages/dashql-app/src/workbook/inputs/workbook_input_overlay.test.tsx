import * as React from 'react';
import { act } from '@akohn/dashql-react/testing/react_act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import { RuntimeContextProvider } from '@akohn/dashql-react/hooks';
import type { ConnectionParams } from '@akohn/dashql/platform/connections/connection_params';
import { createTestRuntime, type TestRuntime } from '@akohn/dashql/runtime/testing/test_runtime';
import { WorkbookInputOverlay, type WorkbookInputOverlayTarget } from './workbook_input_overlay.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const EMBEDDED = { hyper: { endpoint: '', protocol: 'WASM' } } as ConnectionParams;
const TEXT = `/** @param :min = 3 */
select * from orders where amount > :min::int`;

describe('WorkbookInputOverlay', () => {
    let runtime: TestRuntime;
    let container: HTMLDivElement;
    let scroll: HTMLDivElement;
    let root: Root;
    let view: EditorView;

    beforeEach(async () => {
        runtime = await createTestRuntime();
        await runtime.addConnection({ connectionId: 'database', params: EMBEDDED });
        // The container holds the anchor, the editor scrolls in a short element below the top
        container = document.createElement('div');
        container.style.position = 'relative';
        scroll = document.createElement('div');
        scroll.style.cssText = 'height: 120px; overflow: auto;';
        const editorParent = document.createElement('div');
        editorParent.style.cssText = 'padding-top: 40px; height: 600px;';
        scroll.appendChild(editorParent);
        container.appendChild(scroll);
        document.body.appendChild(container);
        view = new EditorView({ parent: editorParent, state: EditorState.create({ doc: TEXT }) });
        root = createRoot(container.appendChild(document.createElement('div')));
    });
    afterEach(async () => {
        act(() => root.unmount());
        view.destroy();
        container.remove();
        await runtime.destroy();
    });

    function render(workbookId: string, target: WorkbookInputOverlayTarget | null, onClose: () => void) {
        act(() => root.render(
            <RuntimeContextProvider value={runtime}>
                <WorkbookInputOverlay
                    workbookId={workbookId}
                    modifyWorkbookScripts={action => runtime.dispatch({ workbook: workbookId }, action)}
                    target={target}
                    containerRef={{ current: container }}
                    getScrollElement={() => scroll}
                    onClose={onClose}
                />
            </RuntimeContextProvider>,
        ));
    }

    it('edits the input of a parameter below it and closes once the parameter scrolls out of view', async () => {
        const workbook = runtime.addWorkbook('database', [['orders.sql', TEXT]]);
        const from = TEXT.indexOf(':min::int');
        const onClose = vi.fn();
        render(workbook.workbookId, { name: 'min', view, from, to: from + 4 }, onClose);

        const overlay = () => document.querySelector<HTMLElement>('[data-testid="workbook-input-overlay"]');
        await vi.waitFor(() => expect(overlay()).not.toBeNull());
        const control = overlay()!.querySelector<HTMLInputElement>('input[aria-label="Value of :min"]')!;
        expect(control.value).toBe('3');
        // The overlay stands below the parameter
        const parameter = view.coordsAtPos(from, 1)!;
        await vi.waitFor(() => expect(overlay()!.getBoundingClientRect().top).toBeGreaterThanOrEqual(parameter.bottom));
        expect(onClose).not.toHaveBeenCalled();

        // The editor scrolls the parameter out of view
        act(() => {
            scroll.scrollTop = 400;
            scroll.dispatchEvent(new Event('scroll'));
        });
        expect(onClose).toHaveBeenCalled();
    });

    it('opens nothing for a name that is no input', async () => {
        const workbook = runtime.addWorkbook('database', [['orders.sql', TEXT]]);
        const onClose = vi.fn();
        render(workbook.workbookId, { name: 'max', view, from: 0, to: 4 }, onClose);
        await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
        expect(document.querySelector('[data-testid="workbook-input-overlay"]')).toBeNull();
    });
});
