import * as Model from '../model';
import { LoggableError } from '../util/error';

export class LogController {
    // The store
    public store: Model.ReduxStore;

    // Constructor
    constructor(store: Model.ReduxStore) {
        this.store = store;
    }

    // Model the log in the redux store
    public storeLog(level: Model.LogLevel, text: string) {
        // Build log entry
        const logEntry = new Model.LogEntry();
        logEntry.level = level;
        logEntry.text = text;
        logEntry.timestamp = new Date();

        // Model in redux store
        this.store.dispatch(Model.pushLogEntry(logEntry));
    }

    // Model a loggable error in the redux log
    public storeError(error: LoggableError) {
        // Build log entry
        const logEntry = new Model.LogEntry();
        logEntry.level = error.logLevel;
        logEntry.text = error.message;
        logEntry.timestamp = new Date();

        // Model in redux store
        this.store.dispatch(Model.pushLogEntry(logEntry));
    }

    // Log levels
    public debug(text: string)      { this.storeLog(Model.LogLevel.LL_DEBUG, text); }
    public info(text: string)       { this.storeLog(Model.LogLevel.LL_INFO, text); }
    public warning(text: string)    { this.storeLog(Model.LogLevel.LL_WARNING, text); }
    public error(text: string)      { this.storeLog(Model.LogLevel.LL_ERROR, text); }
}

export default LogController;

