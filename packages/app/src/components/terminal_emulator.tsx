// ---------------------------------------------------------------------------
// Kudos go to Ioannis Charalampidis.
// Parts of this file were heavily inspired by his local-echo example.
// ---------------------------------------------------------------------------
// https://en.wikipedia.org/wiki/ANSI_escape_code
// http://ascii-table.com/ansi-escape-sequences.php
// http://ascii-table.com/ansi-escape-sequences-vt-100.php
//
// \x1B[K   Clear line from cursor right
// \x1B[0K  Clear line from cursor right
// \x1B[1K  Clear line from cursor left
// \x1B[2K  Clear entire line

import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

// A history buffer
class HistoryBuffer {
    protected buffer: Array<string | null>;
    protected cursor: number;

    // Constructor
    constructor(size = 64) {
        this.buffer = new Array<string | null>(size).fill(null);
        this.cursor = 0;
    }

    // Push a command to the history buffer
    public push(text: string) {
        if (text.trim() === '') {
            return;
        }
        this.buffer[this.cursor] = text;
        this.cursor = (this.cursor + 1) % this.buffer.length;
    }

    // Get the previous command
    public getPrevious(): string | null {
        return this.buffer[(this.cursor + (this.buffer.length - 1)) % this.buffer.length];
    }

    // Get the next command
    public getNext(): string | null {
        return this.buffer[(this.cursor + 1) % this.buffer.length];
    }
}

type ResolveInputFunc = (text: string) => void;
type RejectInputFunc = (text: string) => void;

// A prompt
class Prompt {
    promptPrefix: string;
    continuationPrefix: string;
    resolve: ResolveInputFunc;
    reject: RejectInputFunc;

    input: string;
    inputRowMap: Array<number>;
    inputColumnMap: Array<number>;

    output: string;

    // Constructor
    constructor(promptPrefix = '> ', continuationPrefix = '  ', resolve: ResolveInputFunc, reject: RejectInputFunc) {
        this.promptPrefix = promptPrefix;
        this.continuationPrefix = continuationPrefix;
        this.resolve = resolve;
        this.reject = reject;

        this.input = '';
        this.inputRowMap = new Array<number>();
        this.inputColumnMap = new Array<number>();

        this.output = '';
    }

    // Reset prompt with new text
    public reset(text = '') {
        this.inputRowMap.length = 0;
        this.inputColumnMap.length = 0;
        this.output = this.promptPrefix;
        let row = 0;
        let rowStart = 0;
        for (let i = 0; i < text.length; ++i) {
            this.inputColumnMap.push(this.output.length - rowStart);
            this.output += text[i];
            if (text[i] === '\n') {
                ++row;
                rowStart = this.output.length;
                this.output += this.continuationPrefix;
            }
            this.inputRowMap.push(row);
        }
        this.input = text;
    }

    // Append a string to the prompt
    public append(text: string) {
        let row = this.getLastRow();
        let rowStart = 0;
        for (let i = 0; i < text.length; ++i) {
            this.inputColumnMap.push(this.output.length - rowStart);
            this.output += text[i];
            if (text[i] === '\n') {
                ++row;
                rowStart = this.output.length;
                this.output += this.continuationPrefix;
            }
            this.inputRowMap.push(row);
        }
        this.input += text;
    }

    // Get the cursor position
    public getCursorPosition(cursor: number): [number, number] {
        if (cursor >= this.input.length) {
            return this.getInsertPosition();
        }
        return [this.inputRowMap[cursor], this.inputColumnMap[cursor]];
    }

    // Get the insert position
    public getInsertPosition(): [number, number] {
        if (this.input.length === 0) {
            return [0, 0];
        } else {
            const last = this.input.length - 1;
            return [this.inputRowMap[last], this.inputColumnMap[last] + 1];
        }
    }

    // Get the last row
    public getLastRow(): number {
        if (this.input.length === 0) {
            return 0;
        } else {
            const last = this.input.length - 1;
            return this.inputRowMap[last];
        }
    }
}

// A terminal
export class TerminalEmulator {
    protected term: XTerm;
    protected termFitAddon: FitAddon;
    protected termSize: {
        columns: number;
        rows: number;
    };
    protected history: HistoryBuffer;
    protected activePrompt: Prompt | null;
    protected cursor: number;

    protected onDataHandler: any;
    protected onResizeHandler: any;

    // Constructor
    constructor() {
        this.onDataHandler = this.onData.bind(this);
        this.onResizeHandler = this.onResize.bind(this);

        this.term = new XTerm({
            theme: {
                background: 'rgb(50, 50, 50)',
            },
        });
        this.termFitAddon = new FitAddon();
        this.term.loadAddon(this.termFitAddon);
        this.term.onData(this.onDataHandler);
        this.term.onResize(this.onResizeHandler);
        this.termSize = {
            columns: this.term.cols,
            rows: this.term.rows,
        };
        this.history = new HistoryBuffer();
        this.activePrompt = null;
        this.cursor = 0;
    }

    // ------------------
    // Public
    // ------------------

    // Open terminal in new div element
    public open(element: HTMLDivElement): void {
        this.term.open(element);
        this.termFitAddon.fit();
    }

    // Fit terminal to div element
    public fit(): void {
        this.termFitAddon.fit();
    }

    // Focus on the terminal
    public focus(): void {
        this.term.focus();
    }

    // Attach to terminal events
    public attach(): void {}

    // Detach from terminal events
    public detach(): void {}

    // Read next input from the terminal
    public read(inputPrompt: string, continuationPrompt = '> '): Promise<string> {
        const handler = (resolve: ResolveInputFunc, reject: RejectInputFunc) => {
            this.term.write(inputPrompt);
            this.activePrompt = new Prompt(inputPrompt, continuationPrompt, resolve, reject);
            this.cursor = 0;
        };
        return new Promise(handler.bind(this));
    }

    // Abort pending reads
    public abortRead(reason = 'aborted'): void {
        if (this.activePrompt != null) {
            this.term.write('\r\n');
            this.activePrompt.reject(reason);
            this.activePrompt = null;
        }
    }

    // Print a message
    public print(text: string): void {
        const normed = text.replace(/[\r\n]+/g, '\n');
        this.term.write(normed.replace(/\n/g, '\r\n'));
    }

    // Print a line
    public printLine(text = ''): void {
        this.print(text + '\n');
    }

    // ------------------
    // Internal
    // ------------------

    // Set the input
    protected resetPrompt(input = ''): void {
        if (!this.activePrompt) {
            return;
        }

        // Get the cursor and insert positions of the current prompt
        const cursorPos = this.activePrompt.getCursorPosition(this.cursor);
        const insertPos = this.activePrompt.getInsertPosition();

        // Move cursor to the last line after the last line.
        // \x1B[E: Cursor Next Line
        this.term.write('\r');
        for (let i = 0; i <= insertPos[0] - cursorPos[0]; ++i) {
            this.term.write('\x1B[E');
        }

        // Clear the previous line.
        // \x1B[F: Move to previous line
        // \x1B[2K: Erase full line
        for (let i = 0; i <= insertPos[0]; ++i) {
            this.term.write('\x1B[F\x1B[2K');
        }

        // Reset the prompt
        this.activePrompt.reset(input);
        // Write the prompt output
        this.print(this.activePrompt.output);
        // Set the cursor
        this.cursor = this.activePrompt.input.length;
    }

    // Set the new cursor position, as an offset on the input string
    protected setCursor(newCursor: number): void {
        if (!this.activePrompt) {
            return;
        }
        const c = Math.max(Math.min(newCursor, this.activePrompt.input.length), 0);

        // Get previous and new position
        const prevPos = this.activePrompt.getCursorPosition(this.cursor);
        const newPos = this.activePrompt.getCursorPosition(c);

        // Move vertically
        // \x1B[B: Cursor Down
        // \x1B[A: Cursor Up
        for (let i = prevPos[0]; i < newPos[0]; ++i) {
            this.term.write('\x1B[B');
        }
        for (let i = newPos[0]; i < prevPos[0]; ++i) {
            this.term.write('\x1B[A');
        }

        // Move horizontally
        // \x1B[C: Cursor Forward
        // \x1B[D: Cursor Back
        for (let i = prevPos[1]; i < newPos[1]; ++i) {
            this.term.write('\x1B[C');
        }
        for (let i = newPos[1]; i < prevPos[1]; ++i) {
            this.term.write('\x1B[D');
        }

        // Set the new cursor
        this.cursor = c;
    }

    // Move the cursor backward
    protected moveCursorBack(): void {
        this.setCursor(this.cursor - 1);
    }

    // Move the cursor forward
    protected moveCursorForward(): void {
        this.setCursor(this.cursor + 1);
    }

    // Erase a character before the cursor
    protected eraseBeforeCursor(): void {
        this.setCursor(this.cursor - 1);
        this.eraseAtCursor();
    }

    // Erase a character at the cursor
    protected eraseAtCursor(): void {
        if (!this.activePrompt || this.cursor < 0) {
            return;
        }
        const c = this.cursor;
        this.resetPrompt(
            this.activePrompt.input.substr(0, this.cursor) + this.activePrompt.input.substr(this.cursor + 1),
        );
        this.setCursor(c);
    }

    // Insert at the cursor
    protected insertAtCursor(text: string): void {
        if (!this.activePrompt || this.cursor < 0) {
            return;
        }
        if (this.cursor === this.activePrompt.input.length && !text.includes('\n')) {
            this.activePrompt.append(text);
            this.print(text);
            this.cursor += text.length;
        } else {
            const c = this.cursor;
            this.resetPrompt(
                this.activePrompt.input.substr(0, this.cursor) + text + this.activePrompt.input.substr(this.cursor),
            );
            this.setCursor(c + text.length);
        }
    }

    // Commit an input
    protected commitInput(): void {
        if (!this.activePrompt || this.cursor <= 0) {
            return;
        }
        this.history.push(this.activePrompt.input);
        this.activePrompt.resolve(this.activePrompt.input);
        this.activePrompt = null;
        this.term.write('\r\n');
    }

    // Is the input incomplete?
    protected inputIsComplete(): boolean {
        if (!this.activePrompt) {
            return true;
        }
        if (this.activePrompt.input.endsWith(';')) {
            return true;
        }
        return false;
    }

    // Process terminal data
    protected onData(data: string): void {
        let candidate: string | null = '';
        const prefix = data.charCodeAt(0);
        const input = (this.activePrompt && this.activePrompt.input) || '';

        // Handle ANSI escape sequences
        if (prefix === 0x1b) {
            switch (data.substr(1)) {
                case '[A': // Arrow Up
                    candidate = this.history.getPrevious();
                    if (candidate) {
                        this.resetPrompt(candidate);
                    }
                    break;
                case '[B': // Arrow Down
                    candidate = this.history.getNext();
                    if (candidate) {
                        this.resetPrompt(candidate);
                    }
                    break;
                case '[D': // Arrow Left
                    this.moveCursorBack();
                    break;
                case '[C': // Arrow Right
                    this.moveCursorForward();
                    break;
                case '[3~': // Erase at cursor
                    this.eraseAtCursor();
                    break;
                case '[F': // End
                    this.setCursor(input.length);
                    break;
                case '[H': // Home
                    this.setCursor(0);
                    break;
                case 'b': // Alt + Left
                    this.setCursor(closestLeftBoundary(input, this.cursor));
                    break;
                case 'f': // Alt + Right
                    this.setCursor(closestRightBoundary(input, this.cursor));
                    break;
            }
        } else if (prefix < 32 || prefix === 0x7f) {
            switch (data) {
                case '\r': // Carriage-Return
                    this.insertAtCursor('\n');
                    break;
                case '\x7F': // Backspace
                    this.eraseBeforeCursor();
                    break;
                case '\t': // Tab
                    // TODO autocompletion
                    this.insertAtCursor(' ');
                    break;
                case '\x03': // Ctrl + C
                    if (this.activePrompt) {
                        this.resetPrompt('');
                    } else {
                        this.term.write('^C\r\n');
                    }
                    break;
            }
        } else {
            this.insertAtCursor(data);

            // Command complete?
            if (data.endsWith(';')) {
                this.commitInput();
            }
        }
    }

    // Handle the temrinal resize
    protected onResize(rows: number, columns: number): void {
        if (!this.activePrompt) {
            return;
        }
        const tmp = this.activePrompt.input;
        this.resetPrompt('');
        this.termSize = {
            columns,
            rows,
        };
        this.resetPrompt(tmp);
    }
}

// Detects all the word boundaries on the given input
function wordBoundaries(input: string, leftSide = true): Array<number> {
    let match;
    const words = new Array<number>();
    const rx = /\w+/g;
    while ((match = rx.exec(input))) {
        if (leftSide) {
            words.push(match.index);
        } else {
            words.push(match.index + match[0].length);
        }
    }
    return words;
}

// The closest left word boundary of the given input at the given offset
function closestLeftBoundary(input: string, offset: number) {
    const found = wordBoundaries(input, true)
        .reverse()
        .find(x => x < offset);
    return found == null ? 0 : found;
}

// The closest right word boundary of the given input at the given offset
function closestRightBoundary(input: string, offset: number) {
    const found = wordBoundaries(input, false).find(x => x > offset);
    return found == null ? input.length : found;
}
