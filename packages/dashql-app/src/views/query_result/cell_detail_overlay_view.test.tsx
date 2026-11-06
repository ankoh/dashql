import * as React from 'react';
import * as dashql from '@ankoh/dashql-core';
import { EditorView } from '@codemirror/view';
import { act } from '@dashql/browser-test-act';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as styles from './cell_detail_overlay.module.css';
import { DashQLCoreProvider } from '../../runtime/core_provider.js';
import { LoggerProvider } from '../../platform/logger/logger_provider.js';
import { createTestRoot } from '../../tests/react_root.js';
import { CellDetailOverlay, type CellDetailOverlayProps } from './cell_detail_overlay.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

/// A Hyper plan of a table scan below the result
const PLAN = '{"operator":"executiontarget","operatorId":1,"cardinality":10,"input":{"operator":"tablescan","operatorId":2,"cardinality":10,"debugName":{"classification":"nonsensitive","value":"orders"}}}';

let core: dashql.DashQL;
beforeAll(async () => {
    core = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});

describe('CellDetailOverlay', () => {
    let root: ReturnType<typeof createTestRoot> | null = null;
    beforeEach(() => {
        // The provider fetches the Wasm of the core and instantiates it, the test hands out the instance of the tests
        vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(new Uint8Array([0])));
        // Other tests of the frame may have replaced the factory with a mock already, count the calls of this test
        vi.spyOn(dashql.DashQL, 'create').mockResolvedValue(core).mockClear();
    });
    afterEach(() => {
        root?.unmount();
        root = null;
        vi.restoreAllMocks();
        core.resetUnsafe();
    });

    function props(overrides: Partial<CellDetailOverlayProps>): CellDetailOverlayProps {
        return {
            isOpen: true,
            onClose: vi.fn(),
            formattedValue: null,
            structuredValue: null,
            columnName: 'value',
            dataRow: 3,
            maxRow: 9,
            onNavigate: vi.fn(),
            ...overrides,
        };
    }

    /// Render the overlay and wait until the core is set up and the formats are detected
    async function render(overlay: CellDetailOverlayProps) {
        root ??= createTestRoot();
        await act(async () => {
            root!.render(<LoggerProvider><DashQLCoreProvider><CellDetailOverlay {...overlay} /></DashQLCoreProvider></LoggerProvider>);
        });
        if (overlay.isOpen) {
            // The overlay detects the formats again once it has the core
            await act(async () => {
                await vi.waitFor(() => expect(dashql.DashQL.create).toHaveBeenCalled());
                await vi.mocked(dashql.DashQL.create).mock.results[0].value;
                await new Promise(resolve => setTimeout(resolve, 0));
            });
        }
        return overlay;
    }

    const modal = () => document.querySelector<HTMLElement>(`.${styles.modal}`);
    const button = (label: string) => modal()!.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
    const title = () => modal()!.querySelector(`.${styles.header_title}`)!.textContent;
    const formatButtons = () => Array.from(modal()!.querySelectorAll<HTMLButtonElement>(`[aria-label="Format mode"] button`));
    const formats = () => formatButtons().map(b => b.textContent);
    const selectedFormat = () => formatButtons().find(b => b.getAttribute('aria-current') === 'true')?.textContent ?? null;
    const selectFormat = (label: string) => act(() => formatButtons().find(b => b.textContent === label)!.click());
    /// The text of the CodeMirror view in the body
    const editorText = () => {
        const editor = modal()!.querySelector<HTMLElement>(`.${styles.body} .cm-editor`);
        return editor == null ? null : EditorView.findFromDOM(editor)!.state.doc.toString();
    };
    /// Wait until the CodeMirror view shows the text, it receives the text in an effect after it was created
    const expectEditorText = async (text: string) => {
        await act(async () => { await vi.waitFor(() => expect(editorText()).toBe(text)); });
    };
    /// Wait until the overlay offers the formats, the SQL format needs the parser of the core
    const expectFormats = async (labels: string[]) => {
        await act(async () => { await vi.waitFor(() => expect(formats()).toEqual(labels)); });
    };

    it('renders nothing while closed', async () => {
        await render(props({ isOpen: false, formattedValue: 'abc' }));
        expect(modal()).toBeNull();
    });

    it('shows a plain value as raw text with the row and the field', async () => {
        await render(props({ formattedValue: 'hello world', columnName: 'greeting' }));
        expect(title()).toBe('row=3field=greeting');
        // Any text can be viewed as SQL, text with parse errors starts as raw text
        await expectFormats(['Raw', 'SQL']);
        expect(selectedFormat()).toBe('Raw');
        await expectEditorText('hello world');
    });

    it('shows NULL for a missing value of an unnamed field', async () => {
        await render(props({ columnName: null }));
        expect(title()).toBe('row=3field=value');
        // A single format needs no switch
        expect(modal()!.querySelector('[aria-label="Format mode"]')).toBeNull();
        await expectEditorText('NULL');
    });

    it('shows a valid query as SQL and toggles the pretty format', async () => {
        await render(props({ formattedValue: 'select a, b from items where a = 1' }));
        await expectFormats(['Raw', 'SQL']);
        expect(selectedFormat()).toBe('SQL');
        await expectEditorText('select a, b from items where a = 1');

        const pretty = button('Pretty format');
        expect(pretty.getAttribute('aria-pressed')).toBe('false');
        act(() => pretty.click());
        expect(button('Pretty format').getAttribute('aria-pressed')).toBe('true');
        await expectEditorText('select a, b\nfrom items\nwhere a = 1;');
        act(() => button('Pretty format').click());
        await expectEditorText('select a, b from items where a = 1');

        selectFormat('Raw');
        expect(selectedFormat()).toBe('Raw');
        expect(modal()!.querySelector('button[aria-label="Pretty format"]')).toBeNull();
        await expectEditorText('select a, b from items where a = 1');
    });

    it('starts with the raw text of a query that does not parse', async () => {
        await render(props({ formattedValue: 'select from where' }));
        await expectFormats(['Raw', 'SQL']);
        expect(selectedFormat()).toBe('Raw');
        await expectEditorText('select from where');
    });

    it('shows JSON documents as structured values', async () => {
        await render(props({ formattedValue: '{"id": 7, "tags": ["a", "b"]}' }));
        expect(formats()).toEqual(['Raw', 'Structured']);
        expect(selectedFormat()).toBe('Structured');
        expect(modal()!.querySelector(`.${styles.body}`)!.classList.contains(styles.body_padded)).toBe(true);
        expect(modal()!.querySelector(`.${styles.structured_view}`)!.textContent).toContain('tags');
        expect(editorText()).toBeNull();

        selectFormat('Raw');
        await expectEditorText('{"id": 7, "tags": ["a", "b"]}');
    });

    it('shows the structured values of nested Arrow values', async () => {
        await render(props({ structuredValue: { id: 7n, tags: ['a'] } }));
        expect(formats()).toEqual(['Raw', 'Structured']);
        expect(selectedFormat()).toBe('Structured');
        selectFormat('Raw');
        await expectEditorText(JSON.stringify({ id: '7n', tags: ['a'] }, null, 2));
    });

    it('keeps the picked format when the core arrives after the pick', async () => {
        let provideCore!: (instance: dashql.DashQL) => void;
        vi.mocked(dashql.DashQL.create).mockReturnValue(new Promise(resolve => { provideCore = resolve; }));
        root = createTestRoot();
        await act(async () => {
            root!.render(<LoggerProvider><DashQLCoreProvider><CellDetailOverlay {...props({ structuredValue: { id: 7 } })} /></DashQLCoreProvider></LoggerProvider>);
        });
        expect(selectedFormat()).toBe('Structured');
        selectFormat('Raw');
        expect(selectedFormat()).toBe('Raw');

        // The overlay detects the formats again once it has the core
        await act(async () => {
            await vi.waitFor(() => expect(dashql.DashQL.create).toHaveBeenCalled());
            provideCore(core);
            await new Promise(resolve => setTimeout(resolve, 50));
        });
        expect(selectedFormat()).toBe('Raw');
    });

    it('renders the plans of engines and falls back for plans that do not load', async () => {
        await render(props({ formattedValue: PLAN }));
        expect(formats()).toEqual(['Raw', 'Structured', 'Plan']);
        expect(selectedFormat()).toBe('Plan');
        const plan = () => modal()!.querySelector(`.${styles.plan_container}`);
        await vi.waitFor(() => expect(plan()?.childElementCount).toBeGreaterThan(0));
        expect(modal()!.querySelector(`.${styles.plan_error}`)).toBeNull();

        selectFormat('Structured');
        expect(plan()).toBeNull();
        expect(modal()!.querySelector(`.${styles.structured_view}`)!.textContent).toContain('tablescan');
        root!.unmount();
        root = null;

        // A text that looks like a plan but has no operators
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
        await render(props({ formattedValue: '{"operator": 1}' }));
        expect(selectedFormat()).toBe('Plan');
        await vi.waitFor(() => expect(modal()!.querySelector(`.${styles.plan_error}`)?.textContent).toBe('Could not render plan'));
        expect(warn).toHaveBeenCalled();
    });

    it('expands to the window and restores its size', async () => {
        await render(props({ formattedValue: 'abc' }));
        expect(modal()!.hasAttribute('data-expanded')).toBe(false);
        act(() => button('Expand').click());
        expect(modal()!.hasAttribute('data-expanded')).toBe(true);
        expect(button('Restore size').getAttribute('aria-pressed')).toBe('true');
        act(() => button('Restore size').click());
        expect(modal()!.hasAttribute('data-expanded')).toBe(false);
        expect(button('Expand').getAttribute('aria-pressed')).toBe('false');
    });

    it('closes with the close button and with Escape', async () => {
        const overlay = await render(props({ formattedValue: 'abc' }));
        act(() => button('Close').click());
        expect(overlay.onClose).toHaveBeenCalledTimes(1);
        act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
        expect(overlay.onClose).toHaveBeenCalledTimes(2);
    });

    it('navigates between the rows with the buttons and the arrow keys', async () => {
        const overlay = await render(props({ formattedValue: 'abc' }));
        act(() => button('Previous row').click());
        act(() => button('Next row').click());
        expect(overlay.onNavigate).toHaveBeenNthCalledWith(1, -1);
        expect(overlay.onNavigate).toHaveBeenNthCalledWith(2, 1);

        const key = (k: string) => {
            const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
            act(() => { document.dispatchEvent(event); });
            return event;
        };
        expect(key('ArrowUp').defaultPrevented).toBe(true);
        key('ArrowDown');
        expect(vi.mocked(overlay.onNavigate).mock.calls.slice(2)).toEqual([[-1], [1]]);
    });

    it('does not navigate beyond the first and the last row', async () => {
        const first = await render(props({ formattedValue: 'abc', dataRow: 0, maxRow: 0 }));
        expect(button('Previous row').disabled).toBe(true);
        expect(button('Next row').disabled).toBe(true);
        act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })); });
        act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })); });
        expect(first.onNavigate).not.toHaveBeenCalled();
    });

    it('copies the raw text', async () => {
        const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
        // Other tests of the frame may have replaced the clipboard with a mock already
        writeText.mockClear();
        await render(props({ structuredValue: [1n, 2n] }));
        await act(async () => { button('Copy raw output').click(); });
        expect(writeText).toHaveBeenCalledExactlyOnceWith(JSON.stringify(['1n', '2n'], null, 2));
    });
});
