// ---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
// ---------------------------------------------------------------------------
// Kudos go to Ioannis Charalampidis.
// Parts of this file were heavily inspired by his local-echo example.
// ---------------------------------------------------------------------------
// https://en.wikipedia.org/wiki/ANSI_escape_code

import * as xterm from 'xterm';
import * as fit from 'xterm/lib/addons/fit/fit';
import 'xterm/dist/xterm.css';

xterm.Terminal.applyAddon(fit);

type ResolveInputFunc = (text: string) => void;
type RejectInputFunc = (text: string) => void;

// An active prompt
interface ActivePrompt {
    inputPrompt: string;
    continuationPrompt: string;
    resolve: ResolveInputFunc;
    reject: RejectInputFunc;
}

// An active char prompt
interface ActiveCharPrompt {
    inputPrompt: string;
    resolve: ResolveInputFunc;
    reject: RejectInputFunc;
}

// A history buffer
class HistoryBuffer {
    protected buffer: Array<string | null>;
    protected cursor: number;

    constructor(size: number = 64) {
        this.buffer = new Array<string | null>(size).fill(null);
        this.cursor = 0;
    }

    public push(text: string) {
        if (text.trim() === "") {
            return;
        }
        this.buffer[this.cursor] = text;
        this.cursor = (this.cursor + 1) % this.buffer.length;
    }

    public getPrevious(): string | null {
        return this.buffer[(this.cursor + (this.buffer.length - 1)) % this.buffer.length];
    }

    public getNext(): string | null {
        return this.buffer[(this.cursor + 1) % this.buffer.length];
    }
}

// Detects all the word boundaries on the given input
function wordBoundaries(input: string, leftSide: boolean = true): Array<number> {
    let match;
    let words = new Array<number>();
    let rx = /\w+/g;
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
    let found = wordBoundaries(input, true)
        .reverse()
        .find(x => x < offset);
    return found == null ? 0 : found;
}

// The closest right word boundary of the given input at the given offset
function closestRightBoundary(input: string, offset: number) {
    let found = wordBoundaries(input, false).find(x => x > offset);
    return found == null ? input.length : found;
}

// Convert offset at the given input to position.
// TODO: Maintain the line breaks?
function offsetToPos(input: string, offset: number, maxCols: number) {
    let row = 0, col = 0;
    for (let i = 0; i < offset; ++i) {
        if (input.charAt(i) === "\n") {
            col = 0;
            row += 1;
        } else {
            col += 1;
            if (col > maxCols) {
                col = 0;
                row += 1;
            }
        }
    }
    return { row, col };
}

// Counts the lines in the given input
function countLines(input: string, maxCols: number) {
    return offsetToPos(input, input.length, maxCols).row + 1;
}

// A terminal
export class TerminalController {
    protected term: xterm.Terminal;
    protected termSize: {
        columns: number;
        rows: number;
    };
    protected active: boolean;
    protected activePrompt: ActivePrompt | null;
    protected activeCharPrompt: ActiveCharPrompt | null;
    protected input: string;
    protected history: HistoryBuffer;
    protected cursor: number;

    // Constructor
    constructor() {
        this.term = new xterm.Terminal();
        this.termSize = {
            columns: this.term.cols,
            rows: this.term.rows,
        };
        this.active = false;
        this.activePrompt = null;
        this.activeCharPrompt = null;
        this.input = "";
        this.history = new HistoryBuffer();
        this.cursor = 0;
    }

    // ------------------
    // Internal
    // ------------------

    // Apply prompts to the given input
    protected applyPrompts(input: string): string {
        let inputPrompt = (this.activePrompt && this.activePrompt.inputPrompt) || "";
        let continuationPrompt = (this.activePrompt && this.activePrompt.continuationPrompt) || "";
        return inputPrompt + input.replace(/\n/g, "\n" + continuationPrompt);
    }

    // Apply the offset as required in order to accompany the prompt additions to the input
    protected applyPromptOffset(input: string, offset: number): number {
        let newInput = this.applyPrompts(input.substr(0, offset));
        return newInput.length;
    }

    // Clear the input.
    // This function will erase all the lines that display the current prompt
    // and move the cursor to the beginning of the first line of the prompt.
    protected clearInput() {
        let currentPrompt = this.applyPrompts(this.input);
        let promptCursor = this.applyPromptOffset(this.input, this.cursor);
        let offsetInPrompt = offsetToPos(currentPrompt, promptCursor, this.termSize.columns);
        let totalPromptLines = countLines(currentPrompt, this.termSize.columns);

        // Move cursor to the last line in the prompt.
        // \x1B[E: Cursor Next Line
        for (let i = 0; i < totalPromptLines - offsetInPrompt.row - 1; ++i) {
            this.term.write("\x1B[E");
        }

        // Clear the current line.
        // \x1B[F: Cursor Previous Line
        // \x1B[K: Cursor Erase Line
        for (let i = 1; i < totalPromptLines; ++i) {
            this.term.write("\x1B[F\x1B[K")
        }
    }

    // Replace the input.
    // This function clears all the lines that the current input occupies
    // and then replaces them with the new input.
    protected setInput(newInput: string, clearInput: boolean = true) {
        if (clearInput) {
            this.clearInput();
        }

        // Write the new input lines, including the current prompt
        let newPrompt = this.applyPrompts(newInput);
        this.print(newPrompt);

        // Trim cursor overflow
        if (this.cursor > newInput.length) {
            this.cursor = newInput.length;
        }

        // Move the cursor
        let newCursor = this.applyPromptOffset(newInput, this.cursor);
        let newLines = countLines(newPrompt, this.termSize.columns);
        let newPos = offsetToPos(newPrompt, newCursor, this.termSize.columns);

        this.term.write("\r");

        // Adjust vertically.
        // \x1B[F: Cursor Previous Line
        for (let i = 0; i < newLines - newPos.row - 1; ++i) {
            this.term.write("\x1B[F");
        }

        // Move horizontally
        // \x1B[F: Cursor Forward
        for (let i = 0; i < newPos.col; ++i) {
            this.term.write("\x1B[C");
        }

        this.input = newInput;
    }

    // Set the new cursor position, as an offset on the input string
    protected setCursor(newCursor: number) {
        newCursor = Math.min(Math.max(0, newCursor), this.input.length);

        // Apply prompt formatting
        let inputWithPrompt = this.applyPrompts(this.input);

        // Compute previous cursor position
        let prevOffset = this.applyPromptOffset(this.input, this.cursor);
        let prevPos = offsetToPos(inputWithPrompt, prevOffset, this.termSize.columns);

        // Compute next cursor position
        let newOffset = this.applyPromptOffset(this.input, newCursor);
        let newPos = offsetToPos(inputWithPrompt, newOffset, this.termSize.columns);

        // Move vertically
        // \x1B[B: Cursor Down
        // \x1B[A: Cursor Up
        for (let i = prevPos.row; i < newPos.row; ++i) {
            this.term.write("\x1B[B");
        }
        for (let i = newPos.row; i < prevPos.row; ++i) {
            this.term.write("\x1B[A");
        }

        // Move horizontally
        // \x1B[C: Cursor Forward
        // \x1B[D: Cursor Back
        for (let i = prevPos.col; i < newPos.col; ++i) {
            this.term.write("\x1B[C");
        }
        for (let i = newPos.col; i < prevPos.col; ++i) {
            this.term.write("\x1B[D");
        }

        // Set the new offset
        this.cursor = newCursor;
    }

    // Move the cursor backward
    protected moveCursorBack() {
        this.setCursor(this.cursor - 1);
    }

    // Move the cursor forward
    protected moveCursorForward() {
        this.setCursor(this.cursor + 1);
    }

    // Erase a character before the cursor
    protected eraseBeforeCursor() {
        if (this.cursor <= 0) {
            return;
        }
        let newInput = this.input.substr(0, this.cursor - 1) + this.input.substr(this.cursor);
        this.cursor -= 1;
        this.setInput(newInput, true);
    }

    // Erase a character at the cursor
    protected eraseAtCursor() {
        let newInput = this.input.substr(0, this.cursor) + this.input.substr(this.cursor + 1);
        this.setInput(newInput, true);
    }

    // Insert at the cursor
    protected insertAtCursor(text: string) {
        let newInput = this.input.substr(0, this.cursor) + text + this.input.substr(this.cursor);
        this.cursor += text.length;
        this.setInput(newInput);
    }

    // Commit an input
    protected commitInput() {
        this.history.push(this.input);
        if (this.activePrompt != null) {
            this.activePrompt.resolve(this.input);
            this.activePrompt = null;
        }
        this.term.write('\r\n');
        this.active = false;
    }

    // Resize the temrinal
    protected resizeTerminal(rows: number, columns: number) {
        this.clearInput();
        this.termSize = {
            columns,
            rows,
        };
        this.setInput(this.input, false);
    }

    // Is the input incomplete?
    protected inputIsIncomplete() {
        // Input ends with semicolon?
        if (this.input.endsWith(";")) {
            return true;
        }
        return false;
    }

    // Process user input
    protected process(data: string) {
        if (!this.active) {
            return;
        }
        let prefix = data.charCodeAt(0);

        // Handle ANSI escape sequences
        if (prefix === 0x1b) {
            switch (data.substr(1)) {
                case "[A": // Arrow Up
                    let value = this.history.getPrevious();
                    if (value) {
                        this.setInput(value);
                        this.setCursor(value.length);
                    }
                    break;
                case "[B": // Arrow Down
                    if (this.history) {
                        let value = this.history.getNext();
                        if (value) {
                            this.setInput(value);
                            this.setCursor(value.length);
                        }
                    }
                    break;
                case "[D": // Arrow Left
                    this.moveCursorBack();
                    break;
                case "[C": // Arrow Right
                    this.moveCursorForward();
                    break;
                case "[3~": // Erase at cursor
                    this.eraseAtCursor();
                    break;
                case "[F": // End
                    this.setCursor(this.input.length);
                    break;
                case "[H": // Home
                    this.setCursor(0);
                    break;
                case "b": // ALT + LEFT
                    this.setCursor(closestLeftBoundary(this.input, this.cursor));
                    break;
                case "f": // ALT + RIGHT
                    this.setCursor(closestRightBoundary(this.input, this.cursor));
                    break;
                case "\x7F": // CTRL + BACKSPACE
                    let o = closestLeftBoundary(this.input, this.cursor);
                    this.setInput(this.input.substr(0, o) + this.input.substr(this.cursor));
                    this.setCursor(o);
                    break;
            }
        } else if (prefix < 32 || prefix === 0x7f) {
            switch (data) {
                case "\r": // ENTER
                    if (this.inputIsIncomplete()) {
                        this.insertAtCursor("\n");
                    } else {
                        this.commitInput();
                    }
                    break;
                case "\x7F": // BACKSPACE
                    this.eraseBeforeCursor();
                    break;
                case "\t": // TAB
                    // TODO autocompletion
                    this.insertAtCursor(" ");
                    break;
                case "\x03": // CTRL + C
                    this.setCursor(this.input.length);
                    this.term.write("^C\r\n" + ((this.activePrompt && this.activePrompt.inputPrompt) || ""));
                    this.input = "";
                    this.cursor = 0;
                    break;
            }
        } else {
            this.insertAtCursor(data);
        }
    }


    // ------------------
    // Public API
    // ------------------

    // Return a promise that will resolve when the user has completed typing a single line
    public read(inputPrompt: string, continuationPrompt: string = "> ") {
        let t = this;
        return new Promise(function (resolve: ResolveInputFunc, reject: RejectInputFunc): void {
            t.term.write(inputPrompt);
            t.activePrompt = {
                inputPrompt,
                continuationPrompt,
                resolve,
                reject
            };
            t.input = "";
            t.cursor = 0;
            t.active = true;
        });
    }

    // Return a promise that will resolve when the user has completed typeing a single char
    public readChar(inputPrompt: string) {
        let t = this;
        return new Promise(function (resolve: ResolveInputFunc, reject: RejectInputFunc): void {
            t.term.write(inputPrompt);
            t.activeCharPrompt = {
                inputPrompt,
                resolve,
                reject
            };
        });
    }

    // Abort a message and changes line
    public abortRead(reason: string = "aborted") {
        if (this.activePrompt != null) {
            this.term.write("\r\n");
            this.activePrompt.reject(reason);
            this.activePrompt = null;
        } else if (this.activeCharPrompt != null) {
            this.term.write("\r\n");
            this.activeCharPrompt.reject(reason);
            this.activeCharPrompt = null;
        }
        this.active = false;
    }

    // Print a message
    public print(msg: string) {
        let normed = msg.replace(/[\r\n]+/g, "\n");
        this.term.write(normed.replace(/\n/g, "\r\n"));
    }

    // Print a line
    public printLine(msg: string) {
        this.print(msg + "\n");
    }

    // Prints a list of items using a wide-format
    public printWide(items: Array<string>, padding: number = 2) {
        if (items.length === 0) {
            return this.printLine("");
        }

        // Compute item sizes and matrix row/cols
        const itemWidth = items.reduce((width, item) => Math.max(width, item.length), 0) + padding;
        const wideCols = Math.floor(this.termSize.columns / itemWidth);
        const wideRows = Math.ceil(items.length / wideCols);

        // Print matrix
        let i = 0;
        for (let row = 0; row < wideRows; ++row) {
            let rowStr = "";

            // Prepare columns
            for (let col = 0; col < wideCols; ++col) {
                if (i < items.length) {
                let item = items[i++];
                item += " ".repeat(itemWidth - item.length);
                rowStr += item;
                }
            }
            this.printLine(rowStr);
        }
    }

}
