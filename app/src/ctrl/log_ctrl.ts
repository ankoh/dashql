import * as Store from '../store';
import { LoggableError } from '../util/error';

export class LogController {
    // The store
    public store: Store.ReduxStore;

    // Constructor
    constructor(store: Store.ReduxStore) {
        this.store = store;
    }

    protected log(level: Store.LogLevel, text: string) {
        // Build log entry
        const logEntry = new Store.LogEntry();
        logEntry.level = level;
        logEntry.text = text;
        logEntry.timestamp = new Date();

        // Store in redux store
        this.store.dispatch(Store.pushLogEntry(logEntry));
    }

    public logError(error: LoggableError) {
        // Build log entry
        const logEntry = new Store.LogEntry();
        logEntry.level = error.logLevel;
        logEntry.text = error.message;
        logEntry.timestamp = new Date();

        // Store in redux store
        this.store.dispatch(Store.pushLogEntry(logEntry));
    }

    // Log levels
    public debug(text: string) {
        this.log(Store.LogLevel.DEBUG, text);
    }
    public info(text: string) {
        this.log(Store.LogLevel.INFO, text);
    }
    public warning(text: string) {
        this.log(Store.LogLevel.WARNING, text);
    }
    public error(text: string) {
        this.log(Store.LogLevel.ERROR, text);
    }
}

export default LogController;
