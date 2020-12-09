import { AppReduxStore, AppStateMutation, LogEntry, LogLevel } from '../model';
import { LoggableError } from '../util/error';

export class LogController {
    // The store
    public store: AppReduxStore;

    // Constructor
    constructor(store: AppReduxStore) {
        this.store = store;
    }

    protected log(level: LogLevel, text: string) {
        // Build log entry
        const logEntry = new LogEntry();
        logEntry.level = level;
        logEntry.text = text;
        logEntry.timestamp = new Date();

        // Store in redux store
        this.store.dispatch(AppStateMutation.pushLogEntry(logEntry));
    }

    public logError(error: LoggableError) {
        // Build log entry
        const logEntry = new LogEntry();
        logEntry.level = error.logLevel;
        logEntry.text = error.message;
        logEntry.timestamp = new Date();

        // Store in redux store
        this.store.dispatch(AppStateMutation.pushLogEntry(logEntry));
    }

    // Log levels
    public debug(text: string)      { this.log(LogLevel.DEBUG, text); }
    public info(text: string)       { this.log(LogLevel.INFO, text); }
    public warning(text: string)    { this.log(LogLevel.WARNING, text); }
    public error(text: string)      { this.log(LogLevel.ERROR, text); }
}
