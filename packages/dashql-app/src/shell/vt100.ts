export enum VT100Command {
    INSERT_CHARACTER = '@',
    CURSOR_UP = 'A',
    CURSOR_DOWN = 'B',
    CURSOR_FORWARD = 'C',
    CURSOR_BACKWARD = 'D',
    INSERT_LINE = 'L',
    DELETE_LINE = 'M',
    DELETE_CHARACTER = 'P',
}

export const VT100 = {
    ESCAPE: '\x1b',
    CSI: '\x1b[',
    CARRIAGE_RETURN: '\r',
    NEW_LINE: '\r\n',
    ERASE_ENTIRE_LINE: '\x1b[2K',
    SAVE_CURSOR: '\x1b[s',
    RESTORE_CURSOR: '\x1b[u',
    ENABLE_AUTO_WRAP: '\x1b[?7h',
    DISABLE_AUTO_WRAP: '\x1b[?7l',
    CLEAR_SCREEN: '\x1b[2J\x1b[H',
    RESET_ATTRIBUTES: '\x1b[0m',
    BOLD: '\x1b[1m',
    REVERSE_VIDEO: '\x1b[7m',
    FOREGROUND_BRIGHT_BLACK: '\x1b[90m',
    BOLD_FOREGROUND_PINK: '\x1b[1;38;2;255;122;178m',
    FOREGROUND_CORAL: '\x1b[38;2;255;129;112m',
    FOREGROUND_TEAL: '\x1b[38;2;107;170;159m',
} as const;

// Mirrors the shell core's parameterized CSI encoding for browser-side assertions and adapters.
export function vt100Sequence(count: number, command: VT100Command): string {
    return `${VT100.CSI}${count}${command}`;
}
