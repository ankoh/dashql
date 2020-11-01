import { AppReduxStore } from '../store';
import * as parser from '@dashql/parser';

export class InterpreterController {
    /// The store
    protected _store: AppReduxStore;

    /// Constructor
    constructor(store: AppReduxStore) {
        this._store = store;
    }

    /// Evaluate a program
    public async eval(_program: parser.FlatBuffer<parser.proto.syntax.Module>) {}
}
