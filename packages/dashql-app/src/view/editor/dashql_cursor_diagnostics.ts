import * as dashql from '../../core/index.js';

import { Tooltip, showTooltip } from '@codemirror/view';
import { Transaction, StateField, EditorState } from '@codemirror/state';

import { DashQLCompletionStatus, DashQLProcessorPlugin, DashQLScriptBuffers } from './dashql_processor.js';

function findErrorAtCursor(
    parsed: dashql.buffers.parser.ParsedScript,
    cursor: number,
): dashql.buffers.parser.Error | null {
    const tmp = new dashql.buffers.parser.Error();
    for (let i = 0; i < parsed.scannerErrorsLength(); ++i) {
        const error = parsed.scannerErrors(i, tmp)!;
        const loc = error.textSpan()!;
        if (loc.offset() <= cursor && loc.offset() + loc.length() >= cursor) {
            return error;
        }
    }
    for (let i = 0; i < parsed.parserErrorsLength(); ++i) {
        const error = parsed.parserErrors(i, tmp)!;
        const loc = error.textSpan()!;
        if (loc.offset() <= cursor && loc.offset() + loc.length() >= cursor) {
            return error;
        }
    }
    return null;
}

class CursorDiagnosticsState {
    public readonly buffers: DashQLScriptBuffers;
    public readonly tooltip: Tooltip;

    constructor(buffers: DashQLScriptBuffers, tooltip: Tooltip) {
        this.buffers = buffers;
        this.tooltip = tooltip;
    }

    public equals(other: CursorDiagnosticsState): boolean {
        return this.buffers == other.buffers && this.tooltip.pos == other.tooltip.pos;
    }

    static tryCreate(buffers: DashQLScriptBuffers, pos: number): (CursorDiagnosticsState | null) {
        if (buffers.parsed) {
            const parsed = buffers.parsed.read();
            const error = findErrorAtCursor(parsed, pos);
            if (error != null) {
                const tooltip: Tooltip = {
                    pos,
                    arrow: true,
                    create: () => {
                        const dom = document.createElement('div');
                        dom.className = 'cm-tooltip-cursor';
                        dom.textContent = error.message();
                        return { dom };
                    },
                };
                return new CursorDiagnosticsState(buffers, tooltip);
            }
        }
        return null;
    }
}

function createDiagnosticsTooltip(state: EditorState, pos: number): Tooltip | null {
    const processor = state.field(DashQLProcessorPlugin);
    if (processor.scriptBuffers.parsed) {
        const parsed = processor.scriptBuffers.parsed.read();
        const error = findErrorAtCursor(parsed, pos);
        if (error != null) {
            return {
                pos,
                arrow: true,
                create: () => {
                    const dom = document.createElement('div');
                    dom.className = 'cm-tooltip-cursor';
                    dom.textContent = error.message();
                    return { dom };
                },
            };
        }
    }
    return null;
}

const CursorDiagnosticsField = StateField.define<CursorDiagnosticsState | null>({
    create: () => null,
    update: (prevState: CursorDiagnosticsState | null, transaction: Transaction) => {
        // Is there any cursor?
        const sel = transaction.selection?.ranges ?? [];
        if (sel.length == 0) {
            return null;
        }
        const pos = sel[0].head;

        // Get the script buffers
        const processor = transaction.state.field(DashQLProcessorPlugin);
        if (processor.scriptBuffers == null) {
            return null;
        }

        // Ongoing completion?
        if (processor.scriptCompletion?.status == DashQLCompletionStatus.AVAILABLE) {
            return null;
        }

        // Create new diagnostics
        const nextState = CursorDiagnosticsState.tryCreate(processor.scriptBuffers, pos);
        if (prevState == null || nextState == null) {
            return nextState;
        }
        return nextState.equals(prevState) ? prevState : nextState;
    },
    provide: f => showTooltip.computeN([f], state => [state.field(f)?.tooltip ?? null]),
});

export const DashQLCursorDiagnosticsPlugin = [CursorDiagnosticsField];
