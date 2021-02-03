import * as webdb from '@dashql/webdb/dist/webdb_async';
import * as model from "../model";
import * as error from "../error";

export class LogManager implements webdb.Logger {
    // The store
    public _store: model.DerivedReduxStore;

    // Constructor
    constructor(store: model.DerivedReduxStore) {
        this._store = store;
    }

    public log(entry: model.LogEntryVariant) {
        // XXX Rotate if full
        // XXX Eventually push to service bus 
        model.mutate(this._store.dispatch, {
            type: model.StateMutationType.LOG_PUSH_ENTRY,
            data: entry,
        });
    }
}
