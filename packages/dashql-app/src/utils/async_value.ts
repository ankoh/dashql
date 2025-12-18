import { LoggableException } from "../platform/logger.js";

const LOG_CTX = 'async_value';

type Resolver<Value> = (value: Value) => void;
type Rejecter<Error> = (value: Error) => void;

enum AsyncValueStatus {
    PENDING = 0,
    RESOLVED = 1,
    REJECTED = 2
}

export class AsyncValue<Value, Error> {
    protected status: AsyncValueStatus;
    protected resolvedValue: Value | null;
    protected rejectionError: Error | null;

    protected valuePromise: Promise<Value> | null;
    protected resolveFn: Resolver<Value> | null;
    protected rejectFn: Rejecter<Error> | null;

    constructor() {
        this.status = AsyncValueStatus.PENDING;
        this.resolvedValue = null;
        this.rejectionError = null;
        this.valuePromise = null;
        this.resolveFn = null;
        this.rejectFn = null;
    }

    public isResolved(): boolean {
        return this.status != AsyncValueStatus.PENDING;
    }
    public async getValue(): Promise<Value> {
        switch (this.status) {
            case AsyncValueStatus.RESOLVED:
                return Promise.resolve(this.resolvedValue!);
            case AsyncValueStatus.REJECTED:
                return Promise.reject(this.rejectionError!);
            case AsyncValueStatus.PENDING: {
                if (this.valuePromise == null) {
                    this.valuePromise = new Promise<Value>((resolve, reject) => {
                        this.resolveFn = resolve;
                        this.rejectFn = reject
                    });
                }
                return this.valuePromise;
            }
        }
    }
    public getResolvedValue(): Value {
        switch (this.status) {
            case AsyncValueStatus.RESOLVED:
                return this.resolvedValue!;
            case AsyncValueStatus.REJECTED:
                throw this.rejectionError;
            case AsyncValueStatus.PENDING:
                throw new Error("async value is not resolved");
        }
    }
    public resolve(value: Value) {
        if (this.status != AsyncValueStatus.PENDING) {
            throw new LoggableException("tried to resolve an async value that is not pending", {}, LOG_CTX);
        }
        this.resolvedValue = value;
        this.status = AsyncValueStatus.RESOLVED;
        if (this.resolveFn != null) {
            this.resolveFn(value);
        }
    }
    public reject(error: Error) {
        if (this.status != AsyncValueStatus.PENDING) {
            throw new LoggableException(`tried to reject an async value that is not pending with error: ${error}`, {}, LOG_CTX);
        }
        this.rejectionError = error;
        this.status = AsyncValueStatus.REJECTED;
        if (this.rejectFn != null) {
            this.rejectFn(error);
        }
    }
}
