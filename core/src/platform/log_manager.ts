import * as model from "../model";
import * as error from "../error";

export class LogManager {
    // The store
    public _store: model.DerivedReduxStore;

    // Constructor
    constructor(store: model.DerivedReduxStore) {
        this._store = store;
    }

    protected log(entry: model.LogEntryVariant) {
        // XXX Rotate if full
        // XXX Eventually push to service bus 
        model.mutate(this._store.dispatch, {
            type: model.StateMutationType.LOG_PUSH_ENTRY,
            data: entry,
        });
    }
}
