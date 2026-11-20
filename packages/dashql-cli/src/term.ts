// What the commands share about the terminal: the live terminal, the symbols of a status, the widths of text with
// escape sequences, numbers, durations and paths
import { homedir } from 'node:os';
import path from 'node:path';

/// The terminal that stdout writes to. A command draws a live view only on one, it prints plain text otherwise, e.g.
/// to an agent, a pipe or a file.
export interface Terminal {
    /// The columns of the terminal, they change when the window is resized
    columns(): number;
}

/// The terminal of stdout, null if stdout is no terminal or a dumb one
export function stdoutTerminal(): Terminal | null {
    if (process.stdout.isTTY !== true || process.env.TERM === 'dumb') return null;
    return { columns: () => process.stdout.columns || 80 };
}

/// The symbols of the statuses, each one next to a word
export const SYMBOLS = {
    ok: '✓',
    failed: '✗',
    notRun: '⊘',
    waiting: '·',
    spinner: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
} as const;

/// The escape sequences of the live view
export const ANSI = {
    hideCursor: '\x1b[?25l',
    showCursor: '\x1b[?25h',
    /// Up a number of lines to their start, then clear to the end of the screen
    eraseLines: (n: number) => n > 0 ? `\x1b[${n}F\x1b[J` : '',
} as const;

const ESCAPE = /\x1b\[[0-9;?]*[A-Za-z]/y;

/// The visible length of text with escape sequences, in code points
export function visibleLength(text: string): number {
    let length = 0;
    for (let i = 0; i < text.length;) {
        ESCAPE.lastIndex = i;
        const escape = ESCAPE.exec(text);
        if (escape != null) {
            i += escape[0].length;
            continue;
        }
        const codePoint = text.codePointAt(i)!;
        i += codePoint > 0xffff ? 2 : 1;
        ++length;
    }
    return length;
}

/// Cut text with escape sequences to a visible width, with … at the end of a cut. A line of the live view must not
/// wrap, the view counts its lines to erase them.
export function clipLine(text: string, width: number): string {
    if (visibleLength(text) <= width) return text;
    let out = '';
    let length = 0;
    for (let i = 0; i < text.length;) {
        ESCAPE.lastIndex = i;
        const escape = ESCAPE.exec(text);
        if (escape != null) {
            out += escape[0];
            i += escape[0].length;
            continue;
        }
        if (length === width - 1) break;
        const codePoint = text.codePointAt(i)!;
        const size = codePoint > 0xffff ? 2 : 1;
        out += text.slice(i, i + size);
        i += size;
        ++length;
    }
    return `${out}…\x1b[0m`;
}

/// Count something
export function plural(n: number, noun: string): string {
    return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/// A large count in a few characters: 950, 12.3k, 1.2M
export function compactCount(n: number): string {
    if (n < 1000) return String(n);
    if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
    if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`;
    return `${(n / 1_000_000_000).toFixed(1)}G`;
}

/// Seconds with one decimal, the durations of the plain output
export function seconds(ms: number): string {
    return `${(ms / 1000).toFixed(1)} s`;
}

/// A path relative to a folder if it is inside it, the path itself otherwise
export function pathBelow(file: string, folder: string): string {
    const relative = path.relative(folder, file);
    return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : file;
}

/// A path for people: relative to a folder if it is inside it, from ~ if it is in the home folder
export function shortPath(file: string, folder: string): string {
    const below = pathBelow(file, folder);
    if (below !== file) return below;
    const home = homedir();
    const inHome = path.relative(home, file);
    return inHome.length > 0 && !inHome.startsWith('..') && !path.isAbsolute(inHome) ? path.join('~', inHome) : file;
}
