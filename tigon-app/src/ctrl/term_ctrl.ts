import * as React from 'react';
import * as Model from '../model';
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
    protected termContainer: React.RefObject<HTMLDivElement>;
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
        this.termContainer = React.createRef();
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
    protected handleTermResize(rows: number, cols: number) {
        this.clearInput();
    }

    /// Return a promise that will resolve when the user has completed typing a single line
    protected read(inputPrompt: string, continuationPrompt: string = "> ") {
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
    protected readChar(inputPrompt: string) {
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
}
