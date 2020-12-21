import { error, model } from '@dashql/core';
import { AppReduxStore } from '../model';

export class LogController {
    // The store
    public store: AppReduxStore;

    // Constructor
    constructor(store: AppReduxStore) {
        this.store = store;
    }

    protected log(level: model.LogLevel, text: string) {
        // Build log entry
        const logEntry: model.LogEntry = {
            level: level,
            text: text,
            timestamp: new Date(),
        };

        // Store in redux store
        this.store.dispatch({
            type: model.StateMutationType.LOG_PUSH_ENTRY,
            payload: logEntry,
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
        this.store.dispatch({
            type: model.StateMutationType.LOG_PUSH_ENTRY,
            payload: logEntry,
        });
    }

    // Log levels
    public debug(text: string)      { this.log(model.LogLevel.DEBUG, text); }
    public info(text: string)       { this.log(model.LogLevel.INFO, text); }
    public warning(text: string)    { this.log(model.LogLevel.WARNING, text); }
    public error(text: string)      { this.log(model.LogLevel.ERROR, text); }
}
