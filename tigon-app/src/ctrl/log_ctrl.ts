import * as Model from '../model';
import { LoggableError } from '../util/error';

export class LogController {
    // The store
    public store: Model.ReduxStore;

    // Constructor
    constructor(store: Model.ReduxStore) {
        this.store = store;
    }

    protected log(level: Model.LogLevel, text: string) {
        // Build log entry
        const logEntry = new Model.LogEntry();
        logEntry.level = level;
        logEntry.text = text;
        logEntry.timestamp = new Date();

        // Model in redux store
        this.store.dispatch(Model.pushLogEntry(logEntry));
    }

    public logError(error: LoggableError) {
        // Build log entry
        const logEntry = new Model.LogEntry();
        logEntry.level = error.logLevel;
        logEntry.text = error.message;
        logEntry.timestamp = new Date();

        // Model in redux store
        this.store.dispatch(Model.pushLogEntry(logEntry));
    }

    // Log levels
    public debug(text: string)      { this.log(Model.LogLevel.LL_DEBUG, text); }
    public info(text: string)       { this.log(Model.LogLevel.LL_INFO, text); }
    public warning(text: string)    { this.log(Model.LogLevel.LL_WARNING, text); }
    public error(text: string)      { this.log(Model.LogLevel.LL_ERROR, text); }
}

export default LogController;

