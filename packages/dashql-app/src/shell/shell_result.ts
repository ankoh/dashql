import * as arrow from 'apache-arrow';

import type { DashQLShellCommand } from './api.js';

export const SHELL_AUTO_OVERLAY_ROW_LIMIT = 100;
const TABLE_FRAME_WIDTH_PER_COLUMN = 3;

export type ShellResultMode = 'auto' | 'overlay' | 'term';

function textWidth(value: unknown): number {
    if (value == null) return 0;
    return String(value).split(/\r?\n/, -1).reduce((width, line) => Math.max(width, Array.from(line).length), 0);
}

export function estimateTerminalTableWidth(table: arrow.Table): number {
    if (table.numCols === 0) return 0;
    let width = TABLE_FRAME_WIDTH_PER_COLUMN * table.numCols + 1;
    for (let columnIndex = 0; columnIndex < table.numCols; ++columnIndex) {
        const column = table.getChildAt(columnIndex);
        let columnWidth = textWidth(table.schema.fields[columnIndex]?.name ?? '');
        if (column != null) {
            for (let rowIndex = 0; rowIndex < table.numRows; ++rowIndex) {
                columnWidth = Math.max(columnWidth, textWidth(column.get(rowIndex)));
            }
        }
        width += Math.max(columnWidth, 1);
    }
    return width;
}

export function shouldShowResultOverlay(mode: ShellResultMode, table: arrow.Table, terminalColumns: number): boolean {
    return mode === 'overlay'
        || (mode === 'auto' && (
            table.numRows > SHELL_AUTO_OVERLAY_ROW_LIMIT
            || estimateTerminalTableWidth(table) > Math.max(terminalColumns, 1)
        ));
}

export function createShellResultCommand(
    getMode: () => ShellResultMode,
    setMode: (mode: ShellResultMode) => void,
): DashQLShellCommand {
    return [
        'result',
        'Set result display: auto, overlay, or term',
        args => {
            if (args.length > 1 || (args.length === 1 && !['auto', 'overlay', 'term'].includes(args[0]))) {
                throw new Error('usage: .result [auto|overlay|term]');
            }
            if (args.length === 1) setMode(args[0] as ShellResultMode);
            const mode = getMode();
            return mode === 'auto'
                ? `Result display: auto (overlay when results exceed ${SHELL_AUTO_OVERLAY_ROW_LIMIT} rows or terminal width)`
                : `Result display: ${mode}`;
        },
    ];
}
