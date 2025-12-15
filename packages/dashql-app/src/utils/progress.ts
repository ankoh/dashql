export class ProgressCounter {
    public started: number;
    public succeeded: number;
    public skipped: number;
    public failed: number;
    public total: number | null;

    constructor(total: number | null = null) {
        this.started = 0;
        this.succeeded = 0;
        this.skipped = 0;
        this.failed = 0;
        this.total = total;
    }

    public clone(): ProgressCounter {
        const out = new ProgressCounter(this.total);
        out.started = this.started;
        out.succeeded = this.succeeded;
        out.failed = this.failed;
        return out;
    }
    public addStarted(n: number = 1): ProgressCounter {
        this.started += n;
        return this;
    }
    public addSucceeded(n: number = 1): ProgressCounter {
        this.succeeded += n;
        return this;
    }
    public addSkipped(n: number = 1): ProgressCounter {
        this.skipped += n;
        return this;
    }
    public addFailed(n: number = 1): ProgressCounter {
        this.failed += n;
        return this;
    }
    public addTotal(n: number = 1): ProgressCounter {
        this.total = (this.total ?? 0) + n;
        return this;
    }
}
