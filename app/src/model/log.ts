/// A log level
export enum LogLevel {
    UNDEFINED = 0,
    DEBUG = 1,
    INFO = 2,
    WARNING = 3,
    ERROR = 4,
}

/// The log entry
export class LogEntry {
    public timestamp: Date = new Date();
    public level: LogLevel = LogLevel.UNDEFINED;
    public text: string = '';
}
