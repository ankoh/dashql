import * as dashql from '../../core/index.js';

import { Tooltip, showTooltip } from '@codemirror/view';
import { Transaction, StateField } from '@codemirror/state';

import { DashQLCompletionStatus, DashQLProcessorPlugin, DashQLScriptBuffers } from './dashql_processor.js';

interface CursorError {
    message: string;
    from: number;
    to: number;
}

function findErrorAtCursor(buffers: DashQLScriptBuffers, cursor: number): CursorError | null {
    const parsed = buffers.parsed?.read() ?? null;
    if (parsed) {
        const tmp = new dashql.buffers.parser.Error();
        for (let i = 0; i < parsed.scannerErrorsLength(); ++i) {
            const error = parsed.scannerErrors(i, tmp)!;
            const loc = error.textSpan()!;
            if (loc.offset() <= cursor && loc.offset() + loc.length() >= cursor) {
                return { message: error.message()!, from: loc.offset(), to: loc.offset() + loc.length() };
            }
        }
        for (let i = 0; i < parsed.parserErrorsLength(); ++i) {
            const error = parsed.parserErrors(i, tmp)!;
            const loc = error.textSpan()!;
            if (loc.offset() <= cursor && loc.offset() + loc.length() >= cursor) {
                return { message: error.message()!, from: loc.offset(), to: loc.offset() + loc.length() };
            }
        }
    }
    const analyzed = buffers.analyzed?.read() ?? null;
    if (analyzed) {
        const tmp = new dashql.buffers.analyzer.AnalyzerError();
        for (let i = 0; i < analyzed.errorsLength(); ++i) {
            const error = analyzed.errors(i, tmp)!;
            const loc = error.textSpan();
            if (!loc) continue;
            if (loc.offset() <= cursor && loc.offset() + loc.length() >= cursor) {
                return { message: error.message()!, from: loc.offset(), to: loc.offset() + loc.length() };
            }
        }
    }
    return null;
}

function createTooltip(error: CursorError): Tooltip {
    return {
        pos: error.from,
        end: error.to,
        arrow: true,
        create: () => {
            const dom = document.createElement('div');
            dom.className = 'cm-tooltip-cursor-diagnostics';
            dom.textContent = error.message;
            return { dom };
        },
    };
}

interface CursorDiagnosticsSnapshot {
    buffers: DashQLScriptBuffers;
    pos: number;
    tooltip: Tooltip | null;
}

const CursorDiagnosticsField = StateField.define<CursorDiagnosticsSnapshot>({
    create: () => ({ buffers: { parsed: null, analyzed: null, destroy: () => {} }, pos: -1, tooltip: null }),
    update: (prev: CursorDiagnosticsSnapshot, transaction: Transaction) => {
        const pos = transaction.state.selection.main.head;
        const processor = transaction.state.field(DashQLProcessorPlugin);
        const buffers = processor.scriptBuffers;

        // Nothing changed?
        if (buffers === prev.buffers && pos === prev.pos) {
            return prev;
        }

        // Hide tooltip during active completion
        if (processor.scriptCompletion?.status == DashQLCompletionStatus.AVAILABLE) {
            return { buffers, pos, tooltip: null };
        }

        const error = findErrorAtCursor(buffers, pos);
        return { buffers, pos, tooltip: error ? createTooltip(error) : null };
    },
    provide: f => showTooltip.computeN([f], state => {
        const tooltip = state.field(f).tooltip;
        return tooltip ? [tooltip] : [];
    }),
});

export const DashQLCursorDiagnosticsPlugin = [CursorDiagnosticsField];
