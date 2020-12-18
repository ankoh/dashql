/// A log level
export enum LogLevel {
    UNDEFINED = 0,
    DEBUG = 1,
    INFO = 2,
    WARNING = 3,
    ERROR = 4,
}

/// The log entry
export interface LogEntry {
    timestamp: Date;
    level: LogLevel;
    text: string;
}
