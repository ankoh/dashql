import * as model from '../model';

export interface Logger {
    log(entry: model.LogEntryVariant): void;
}

export class LogManager implements Logger {
    // The store
    public _store: model.DerivedReduxStore;

    // Constructor
    constructor(store: model.DerivedReduxStore) {
        this._store = store;
    }

    public log(entry: model.LogEntryVariant) {
        // Log errors and warnings to console
        switch (entry.level) {
            case model.LogLevel.WARNING:
                console.warn(entry);
                break;
            case model.LogLevel.ERROR:
                console.error(entry);
                break;
        }

        // Store in redux
        model.mutate(this._store.dispatch, {
            type: model.StateMutationType.LOG_PUSH_ENTRY,
            data: entry,
        });
    }
}
