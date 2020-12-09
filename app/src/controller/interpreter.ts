import { AppReduxStore } from '../store';
import * as core from '@dashql/core';

export class InterpreterController {
    /// The store
    protected _store: AppReduxStore;

    /// Constructor
    constructor(store: AppReduxStore) {
        this._store = store;
    }

    /// Evaluate a program
    public async eval(_program: core.model.FlatBuffer<core.proto.syntax.Program>) {}
}
