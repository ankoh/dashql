export enum ResolvableStatus {
    NONE,
    RUNNING,
    FAILED,
    COMPLETED,
}

export type Resolver<Value> = () => Promise<Value | null>;

export class Resolvable<Value, Progress = null, Error = string> {
    public readonly status: ResolvableStatus;
    public readonly progress: Progress;
    public readonly value: Value | null;
    public readonly error: Error | null;

    constructor(status: ResolvableStatus, progress: Progress, value: Value | null = null, error: Error | null = null) {
        this.status = status;
        this.progress = progress;
        this.value = value;
        this.error = error;
    }

    public resolving(): boolean {
        return this.status != ResolvableStatus.NONE;
    }
    public completeWith(value: Value, progress: Progress | null = null): Resolvable<Value, Progress, Error> {
        return new Resolvable(ResolvableStatus.COMPLETED, progress ?? this.progress, value, this.error);
    }
    public failWith(error: Error, progress: Progress | null = null): Resolvable<Value, Progress, Error> {
        return new Resolvable(ResolvableStatus.FAILED, progress ?? this.progress, this.value, error);
    }
    public updateProgress(progress: Progress): Resolvable<Value, Progress, Error> {
        return new Resolvable(ResolvableStatus.RUNNING, progress, this.value, this.error);
    }
    public updateProgressWith(update: (progress: Progress) => Progress): Resolvable<Value, Progress, Error> {
        return new Resolvable(ResolvableStatus.RUNNING, update(this.progress), this.value, this.error);
    }
}
