import * as Store from '../store';
import { LoggableError } from '../utils/Error';

export class Logger {
    // The store
    public store: Store.ReduxStore;

    // Constructor
    constructor(store: Store.ReduxStore) {
        this.store = store;
    }

    // Store the log in the redux store
    public storeLog(level: Store.LogLevel, text: string) {
        // Build log entry
        const logEntry = new Store.LogEntry();
        logEntry.level = level;
        logEntry.text = text;
        logEntry.timestamp = new Date();

        // Store in redux store
        this.store.dispatch(Store.pushLogEntry(logEntry));
    }

    // Store a loggable error in the redux log
    public storeError(error: LoggableError) {
        // Build log entry
        const logEntry = new Store.LogEntry();
        logEntry.level = error.logLevel;
        logEntry.text = error.message;
        logEntry.timestamp = new Date();

        // Store in redux store
        this.store.dispatch(Store.pushLogEntry(logEntry));
    }

    // Log levels
    public debug(text: string)      { this.storeLog(Store.LogLevel.LL_DEBUG, text); }
    public info(text: string)       { this.storeLog(Store.LogLevel.LL_INFO, text); }
    public warning(text: string)    { this.storeLog(Store.LogLevel.LL_WARNING, text); }
    public error(text: string)      { this.storeLog(Store.LogLevel.LL_ERROR, text); }
}

export default Logger;

