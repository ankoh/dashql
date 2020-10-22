import { AppReduxStore } from '../store';
import * as parser from '@dashql/parser';

import Program = parser.proto.program.Program;
import FlatBuffer = parser.FlatBuffer;

export class Interpreter {
    /// The store
    protected _store: AppReduxStore;

    /// Constructor
    constructor(store: AppReduxStore) {
        this._store = store;
    }

    /// Evaluate a program
    public async eval(_program: FlatBuffer<Program>) {
    }
}

