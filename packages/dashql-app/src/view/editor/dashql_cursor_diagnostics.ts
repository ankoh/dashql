import * as dashql from '@ankoh/dashql-core';

import { Tooltip, showTooltip } from '@codemirror/view';
import { Transaction, StateField, EditorState } from '@codemirror/state';

import { DASHQL_COMPLETION_AVAILABLE, DashQLProcessorPlugin, DashQLScriptBuffers } from './dashql_processor.js';

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
        const findErrorAtLocation = (
            buffer: {
                errors: (index: number, obj?: dashql.buffers.parser.Error) => dashql.buffers.parser.Error | null;
                errorsLength: () => number;
            },
            cursor: number,
        ) => {
            const tmp = new dashql.buffers.parser.Error();
            for (let i = 0; i < buffer.errorsLength(); ++i) {
                const error = buffer.errors(i, tmp)!;
                const errorLoc = error.location()!;
                const errorMatches = errorLoc.offset() <= cursor && errorLoc.offset() + errorLoc.length() >= cursor;
                if (errorMatches) {
                    return error;
                }
            }
            return null;
        };

        if (buffers.scanned) {
            const scanned = buffers.scanned.read();
            const error = findErrorAtLocation(scanned, pos);
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
        if (buffers.parsed) {
            const parsed = buffers.parsed.read();
            const error = findErrorAtLocation(parsed, pos);
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
    const findErrorAtLocation = (
        buffer: {
            errors: (index: number, obj?: dashql.buffers.parser.Error) => dashql.buffers.parser.Error | null;
            errorsLength: () => number;
        },
        cursor: number,
    ) => {
        const tmp = new dashql.buffers.parser.Error();
        for (let i = 0; i < buffer.errorsLength(); ++i) {
            const error = buffer.errors(i, tmp)!;
            const errorLoc = error.location()!;
            const errorMatches = errorLoc.offset() <= cursor && errorLoc.offset() + errorLoc.length() >= cursor;
            if (errorMatches) {
                return error;
            }
        }
        return null;
    };

    if (processor.scriptBuffers.scanned) {
        const scanned = processor.scriptBuffers.scanned.read();
        const error = findErrorAtLocation(scanned, pos);
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
    if (processor.scriptBuffers.parsed) {
        const parsed = processor.scriptBuffers.parsed.read();
        const error = findErrorAtLocation(parsed, pos);
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
        if (processor.scriptCompletion?.type == DASHQL_COMPLETION_AVAILABLE) {
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
