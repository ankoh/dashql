import type * as dashql from '@ankoh/dashql-core';
import type { Terminal } from '@xterm/xterm';

import type { DashQLShell } from './api.js';
import { CandidateListRenderer, collectCandidates, placeBelowOrAbove } from '../views/completion_list/completion_list_view.js';

import * as styles from '../views/completion_list/completion_list.module.css';

/// The completion list of a shell, over the terminal.
/// The shell owns the candidates, the selection and the keys, this only shows what the shell says.
export class TerminalCompletionOverlay {
    /// The list
    readonly list: CandidateListRenderer;
    /// The candidates of the shell
    buffer: dashql.FlatBufferPtr<dashql.buffers.completion.Completion> | null = null;
    /// The revision of the candidates
    revision: bigint | null = null;
    /// The terminal column of the start of the replaced text
    anchorColumn: number = 0;
    /// The anchor that the list is placed at, null if it has to be placed
    placedAt: string | null = null;

    constructor(
        readonly container: HTMLElement,
        readonly terminal: Terminal,
        selectPreviousVariant: () => void,
        selectNextVariant: () => void,
    ) {
        this.list = new CandidateListRenderer(selectPreviousVariant, selectNextVariant);
        // The terminal is dark in both schemes
        this.list.rootElement.classList.add(styles.on_dark_surface);
        // Inside the container and not on the body: the list has to hide with a page that goes to the background
        container.appendChild(this.list.rootElement);
    }

    /// Is a completion list open? It can still be hidden if its row is scrolled out of the terminal.
    public get isOpen() { return this.buffer != null; }

    /// Show what the shell says, after the terminal processed the output of the shell
    public update(shell: DashQLShell) {
        const state = shell.terminalCompletionList();
        if (state == null) {
            this.close();
            return;
        }
        if (this.buffer == null || this.revision !== state.revision) {
            this.buffer = shell.terminalCompletionBuffer();
            this.revision = state.revision;
        }
        if (this.buffer == null) {
            this.close();
            return;
        }
        this.anchorColumn = state.anchorColumn;
        this.list.show();
        this.list.updateCandidates(collectCandidates(this.buffer.read(), state.selection, state.variant));
        // The width of the list can differ now
        this.placedAt = null;
        this.place();
    }

    /// Place the list at its anchor, if the terminal moved it
    public place() {
        if (!this.isOpen) return;
        const screen = this.terminal.element?.querySelector('.xterm-screen');
        if (screen == null) return;
        const rect = screen.getBoundingClientRect();
        const { cols, rows, buffer: { active } } = this.terminal;
        const row = active.baseY + active.cursorY - active.viewportY;
        if (rect.width === 0 || row < 0 || row >= rows) {
            this.list.hide();
            this.placedAt = null;
            return;
        }
        const placedAt = `${rect.left} ${rect.top} ${rect.width} ${rect.height} ${row} ${cols} ${rows} ${this.anchorColumn}`;
        if (placedAt === this.placedAt) return;
        this.placedAt = placedAt;
        const cellWidth = rect.width / cols;
        const cellHeight = rect.height / rows;
        this.list.show();
        this.list.updatePosition(this.list.fitIntoWindow(placeBelowOrAbove({
            left: rect.left + this.anchorColumn * cellWidth,
            top: rect.top + row * cellHeight,
            bottom: rect.top + (row + 1) * cellHeight,
        })));
    }

    /// Close the list
    public close() {
        this.buffer = null;
        this.revision = null;
        this.placedAt = null;
        this.list.hide();
    }

    public destroy() {
        this.close();
        this.list.destroy();
    }
}
