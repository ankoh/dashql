import * as Model from '../model';

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
    public logLevel: Model.LogLevel;
    public message: string;
    constructor(message: string, logLevel: Model.LogLevel = Model.LogLevel.WARNING) {
        super(message);
        this.logLevel = logLevel;
        this.message = message;
    }
}

// An error with a http status code
export class HTTPStatusError extends LoggableError {
    protected statusCode: number;
    constructor(statusCode: number, logLevel: Model.LogLevel = Model.LogLevel.WARNING) {
        super(String(statusCode));
        this.statusCode = statusCode;
    }
}
