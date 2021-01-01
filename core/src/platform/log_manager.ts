import * as model from "../model";
import * as error from "../error";

export class LogManager {
    // The store
    public _store: model.DerivedReduxStore;

    // Constructor
    constructor(store: model.DerivedReduxStore) {
        this._store = store;
    }

    protected log(level: model.LogLevel, text: string) {
        // Build log entry
        const logEntry: model.LogEntry = {
            level: level,
            text: text,
            timestamp: new Date(),
        };

        // Store in redux store
        model.mutate(this._store.dispatch, {
            type: model.StateMutationType.LOG_PUSH_ENTRY,
            data: logEntry,
        });
    }

    public logError(error: error.LoggableError) {
        // Build log entry
        const logEntry: model.LogEntry = {
            level: error.logLevel,
            text: error.message,
            timestamp: new Date(),
        };

        // Store in redux store
        model.mutate(this._store.dispatch, {
            type: model.StateMutationType.LOG_PUSH_ENTRY,
            data: logEntry,
        });
    }

    // Log levels
    public debug(text: string)      { this.log(model.LogLevel.DEBUG, text); }
    public info(text: string)       { this.log(model.LogLevel.INFO, text); }
    public warning(text: string)    { this.log(model.LogLevel.WARNING, text); }
    public error(text: string)      { this.log(model.LogLevel.ERROR, text); }
}
