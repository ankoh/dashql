import * as arrow from 'apache-arrow';
import * as dashql from '@ankoh/dashql-core';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DashQLShell, DashQLShellPromptInput } from './api.js';
import { embedDashQLShell, type BrowserShellController } from './browser_shell.js';
import { TerminalCompletionOverlay } from './completion_overlay.js';
import { tableFromArrays } from '../tests/arrow_fixtures.js';
import * as styles from '../views/completion_list/completion_list.module.css';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

const COLUMNS_PROMPT = 'select * from orders o where o.';

async function createShell(): Promise<DashQLShell> {
    const shell = await DashQLShell.create({
        environment: { executeQuery: async () => arrow.tableToIPC(tableFromArrays({}), 'file') },
        terminalColumns: 80,
        core: await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }),
        trackSessionRelations: true,
    });
    const script = shell.core.createScript(shell.catalog);
    script.replaceText('create table orders(order_id bigint, amount double);');
    script.analyze();
    shell.catalog.loadScript(script, dashql.buffers.catalog.CatalogLayer.CONNECTION);
    script.destroy();
    return shell;
}

/// Does an element have a box? Its own computed display doesn't say if an ancestor hides it.
function isShown(element: Element | null): boolean {
    return element != null && element.getClientRects().length > 0;
}

describe('the completion list of the browser shell', () => {
    let container: HTMLDivElement;
    let shell: DashQLShell;
    let controller: BrowserShellController;
    let columns: number;

    beforeEach(async () => {
        columns = 80;
        container = document.createElement('div');
        container.style.width = '800px';
        container.style.height = '400px';
        document.body.appendChild(container);
        shell = await createShell();
        controller = await embedDashQLShell({ container, shell, onTerminalResize: next => { columns = next; } });
    });

    afterEach(() => {
        controller.dispose();
        shell.destroy();
        container.remove();
    });

    function list(): HTMLElement {
        return container.querySelector<HTMLElement>('[data-dashql-completion-list]')!;
    }

    function rows(): HTMLElement[] {
        return Array.from(list().querySelectorAll<HTMLElement>(`.${styles.candidate_container}`));
    }

    function input(): HTMLTextAreaElement {
        return container.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')!;
    }

    function press(key: string) {
        input().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    }

    async function openList() {
        controller.queuePrompts([COLUMNS_PROMPT]);
        await vi.waitFor(() => expect(isShown(list())).toBe(true));
    }

    it('shows the candidates at the replaced text, below the cursor', async () => {
        await openList();
        expect(rows().map(row => row.querySelector(`.${styles.candidate_name}`)!.textContent)).toContain('order_id');

        // The candidates replace what follows the prompt and the typed text
        const anchorColumn = shell.terminalCompletionList()!.anchorColumn;
        expect(anchorColumn).toBe('dashql> '.length + COLUMNS_PROMPT.length);
        await vi.waitFor(() => {
            const screen = container.querySelector('.xterm-screen')!.getBoundingClientRect();
            const box = list().getBoundingClientRect();
            expect(box.left).toBeCloseTo(screen.left + anchorColumn * screen.width / columns, 0);
            // The first row of the terminal holds the prompt
            expect(box.top).toBeGreaterThan(screen.top);
            expect(box.top).toBeLessThan(screen.top + screen.height / 2);
        });
    });

    it('shows what is known about the selected candidate', async () => {
        await openList();
        const selected = shell.terminalCompletionList()!.selection;
        const pane = list().querySelector(`.${styles.details_container}`)!;
        expect(rows()[selected].classList.contains(styles.selected)).toBe(true);
        expect(isShown(pane)).toBe(true);
        expect(pane.textContent!.toLowerCase()).toMatch(/bigint|double/);
    });

    it('shows the column types of a table that the shell created', async () => {
        await shell.executeQuery('create table created (created_id bigint, created_at timestamp)');
        controller.queuePrompts(['select * from created c where c.created_']);
        await vi.waitFor(() => expect(isShown(list())).toBe(true));
        const pane = list().querySelector(`.${styles.details_container}`)!;
        await vi.waitFor(() => expect(pane.textContent!.toLowerCase()).toMatch(/bigint|timestamp/));
    });

    it('follows the selection of the shell', async () => {
        await openList();
        const before = shell.terminalCompletionList()!;
        press('ArrowDown');
        await vi.waitFor(() => expect(rows()[before.selection + 1].classList.contains(styles.selected)).toBe(true));
        expect(rows()[before.selection].classList.contains(styles.selected)).toBe(false);
        // The candidates are the same, the buffer was not read again
        expect(shell.terminalCompletionList()!.revision).toBe(before.revision);
    });

    it('keeps the focus in the terminal on a click', async () => {
        await openList();
        const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
        rows()[0].dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
    });

    it('applies the selected candidate with Tab', async () => {
        await openList();
        const { selection } = shell.terminalCompletionList()!;
        const name = rows()[selection].querySelector(`.${styles.candidate_name}`)!.textContent!;
        press('Tab');
        expect(shell.movePromptRight().text).toBe(COLUMNS_PROMPT + name);
        // Like in the editor, the list stays closed until the next input
        await vi.waitFor(() => expect(isShown(list())).toBe(false));
        expect(shell.terminalCompletionList()).toBeNull();
    });

    it('closes with Escape and keeps the prompt', async () => {
        await openList();
        press('Escape');
        await vi.waitFor(() => expect(isShown(list())).toBe(false));
        expect(shell.terminalCompletionList()).toBeNull();
        expect(shell.movePromptLeft().text).toBe(COLUMNS_PROMPT);
    });

    it('ends the completion when the terminal loses the focus', async () => {
        await openList();
        input().dispatchEvent(new FocusEvent('blur'));
        await vi.waitFor(() => expect(isShown(list())).toBe(false));
        expect(shell.terminalCompletionList()).toBeNull();
        expect(shell.movePromptLeft().text).toBe(COLUMNS_PROMPT);
    });

    it('hides with the page of the shell', async () => {
        await openList();
        container.style.display = 'none';
        expect(isShown(list())).toBe(false);
        expect(container.contains(list())).toBe(true);
    });

    it('is removed with the shell', async () => {
        await openList();
        controller.dispose();
        expect(container.querySelector('[data-dashql-completion-list]')).toBeNull();
    });

    it('is dark on the terminal, in both schemes', async () => {
        await openList();
        expect(getComputedStyle(list()).colorScheme).toBe('dark');
    });
});

describe('the placement of the completion list', () => {
    let container: HTMLDivElement;
    let shell: DashQLShell;
    let terminal: Terminal;
    let overlay: TerminalCompletionOverlay;

    beforeEach(async () => {
        // A terminal as high as the window, the cursor reaches the bottom of the window
        container = document.createElement('div');
        container.style.position = 'fixed';
        container.style.inset = '0';
        document.body.appendChild(container);
        shell = await createShell();
        terminal = new Terminal({ cols: 80, rows: Math.floor(window.innerHeight / 18), scrollback: 1000 });
        terminal.open(container);
        overlay = new TerminalCompletionOverlay(container, terminal, () => undefined, () => undefined);
    });

    afterEach(() => {
        overlay.destroy();
        terminal.dispose();
        shell.destroy();
        container.remove();
    });

    function write(data: string): Promise<void> {
        return new Promise(resolve => terminal.write(data, resolve));
    }

    async function openListAt(emptyRows: number) {
        await write('\r\n'.repeat(emptyRows) + shell.openTerminal('db> ').data);
        await write(shell.consumeTerminalInput(DashQLShellPromptInput.TEXT, 'sel').data);
        overlay.update(shell);
        // The terminal measures its cells once it rendered
        await vi.waitFor(() => {
            overlay.place();
            expect(isShown(overlay.list.rootElement)).toBe(true);
        });
    }

    it('opens below the cursor if there is room', async () => {
        await openListAt(0);
        expect(isShown(overlay.list.rootElement)).toBe(true);
        expect(overlay.list.rootElement.style.top).not.toBe('');
        expect(overlay.list.rootElement.style.bottom).toBe('');
    });

    it('flips above the cursor at the bottom of the window', async () => {
        await openListAt(terminal.rows * 2);
        const box = overlay.list.rootElement.getBoundingClientRect();
        const screen = terminal.element!.querySelector('.xterm-screen')!.getBoundingClientRect();
        const cursorTop = screen.top + terminal.buffer.active.cursorY * screen.height / terminal.rows;
        expect(overlay.list.rootElement.style.top).toBe('');
        expect(overlay.list.rootElement.style.bottom).not.toBe('');
        expect(box.bottom).toBeLessThanOrEqual(cursorTop);
    });

    it('hides while the cursor is scrolled out of the terminal', async () => {
        await openListAt(terminal.rows * 2);
        expect(isShown(overlay.list.rootElement)).toBe(true);

        terminal.scrollToTop();
        await vi.waitFor(() => {
            overlay.place();
            expect(isShown(overlay.list.rootElement)).toBe(false);
        });
        expect(overlay.isOpen).toBe(true);

        terminal.scrollToBottom();
        await vi.waitFor(() => {
            overlay.place();
            expect(isShown(overlay.list.rootElement)).toBe(true);
        });
    });

    it('closes when the shell has no list anymore', async () => {
        await openListAt(0);
        await write(shell.consumeTerminalInput(DashQLShellPromptInput.ABORT).data);
        overlay.update(shell);
        expect(overlay.isOpen).toBe(false);
        expect(isShown(overlay.list.rootElement)).toBe(false);
    });
});
