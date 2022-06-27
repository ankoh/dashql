// Copyright (c) 2021 The DashQL Authors

import { LogLevel } from './model';

// Inheriting from error requires a tiny hack as the Error class apparently messes up the prototype chain.
// https://stackoverflow.com/questions/41102060/typescript-extending-error-class
export class ErrorBase extends Error {
    constructor(msg: string) {
        super(String(msg));
        const actualProto = new.target.prototype;
        if (Object.setPrototypeOf) {
            Object.setPrototypeOf(this, actualProto);
        } else {
            /* tslint:disable */
            (this as any)['__proto__'] = actualProto;
            /* tslint:enable */
        }
    }
}

// An error that can be logged in the application log
export class LoggableError extends ErrorBase {
    protected _logLevel: LogLevel;
    protected _message: string;
    constructor(message: string, logLevel: LogLevel = LogLevel.WARNING) {
        super(message);
        this._logLevel = logLevel;
        this._message = message;
    }

    public get logLevel(): LogLevel {
        return this._logLevel;
    }
    public get message(): string {
        return this._message;
    }
}

// An error with a http status code
export class HTTPStatusError extends LoggableError {
    protected _statusCode: number;
    constructor(statusCode: number, logLevel: LogLevel = LogLevel.WARNING) {
        super(String(statusCode), logLevel);
        this._statusCode = statusCode;
    }
}
