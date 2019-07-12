import * as xterm from 'xterm';
import * as fit from 'xterm/lib/addons/fit/fit';

import 'xterm/dist/xterm.css';

import { IAppContext, withAppContext } from '../app_context';

xterm.Terminal.applyAddon(fit);

type ResolveInputFunc = (text: string) => void;
type RejectInputFunc = (text: string) => void;

/// An active prompt
interface ActivePrompt {
    inputPrompt: string;
    continuationPrompt: string;
    resolve: ResolveInputFunc;
    reject: RejectInputFunc;
}

/// An active char prompt
interface ActiveCharPrompt {
    inputPrompt: string;
    resolve: ResolveInputFunc;
    reject: RejectInputFunc;
}

/// A history buffer
class HistoryBuffer {
    public push(text: string) {
    }
}

/// A terminal
class Terminal {
    protected term: xterm.Terminal;
    protected termSize: {
        columns: number;
        rows: number;
    };
    protected active: boolean;
    protected activePrompt: ActivePrompt | null;
    protected activeCharPrompt: ActiveCharPrompt | null;
    protected input: string;
    protected history: HistoryBuffer | null;
    protected cursor: number;

    /// Constructor
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
        this.history = null;
        this.cursor = 0;
    }

    /// Clear the input.
    /// This function will erase all the lines that display the current prompt
    /// and move the cursor to the beginning of the first line of the prompt.
    protected clearInput() {
        // TODO
    }

    /// Handle input completion
    protected handleReadComplete() {
        if (this.history != null) {
            this.history.push(this.input);
        }
        if (this.activePrompt != null) {
            this.activePrompt.resolve(this.input);
            this.activePrompt = null;
        }
        this.term.write('\r\n');
        this.active = false;
    }

    /// Handle terminal resize
    protected handleTermResize(rows: number, columns: number) {
        this.clearInput();
        this.termSize = {
            rows,
            columns
        };
        // this.setInput(this.input, false);
    }

    /// Return a promise that will resolve when the user has completed typing a single line
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

    /// Return a promise that will resolve when the user has completed typeing a single char
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

    /// Abort a message and changes line
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

    /// Print a message
    public print(msg: string) {
        let normed = msg.replace(/[\r\n]+/g, "\n");
        this.term.write(normed.replace(/\n/g, "\r\n"));
    }

    /// Print a line
    public println(msg: string) {
        this.print(msg + "\n");
    }

    /// Prints a list of items using a wide-format
    public printWide(items: Array<string>, padding: number = 2) {
        if (items.length == 0) {
            return this.println("");
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
            this.println(rowStr);
        }
    }

}
