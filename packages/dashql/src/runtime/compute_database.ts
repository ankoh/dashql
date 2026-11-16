import type { EmbeddedComputeDatabase } from '../platform/embedded_database.js';

/// The compute database of a platform, it resolves once the platform set it up
export type ComputeDatabaseProvider = () => Promise<EmbeddedComputeDatabase>;

/// The compute database of a runtime over the provider of its platform: the computations, the runs and the query result
/// cache wait for it, and the app reads whether it is ready. It is ready once the provider resolved, until a call of the
/// provider fails, e.g. after a handover of the database. Once the runtime shuts down, a wait for a database that never
/// came up ends, so a provider that never settles holds up no shutdown.
export class ComputeDatabase {
    private readonly listeners = new Set<() => void>();
    private isReady = false;
    private rejectClosing: ((reason: unknown) => void) | null = null;
    private readonly closing: Promise<never>;
    private closed = false;

    constructor(private readonly provider: ComputeDatabaseProvider | null) {
        this.closing = new Promise<never>((_resolve, reject) => { this.rejectClosing = reject; });
        // Nobody may wait for it
        this.closing.catch(() => { });
    }

    /// Is there a provider?
    get available(): boolean {
        return this.provider != null;
    }

    /// Did the provider resolve the last time it was asked?
    get ready(): boolean {
        return this.isReady;
    }

    /// Hear when `ready` changes, returns the function that stops it
    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /// The database, once the platform set it up
    get(): Promise<EmbeddedComputeDatabase> {
        if (this.provider == null) return Promise.reject(new Error('the platform has no compute database'));
        const wasReady = this.isReady;
        const database = this.provider().then(
            database => {
                this.setReady(true);
                return database;
            },
            (error: unknown) => {
                this.setReady(false);
                throw error;
            },
        );
        // A database that came up is waited for, also while the runtime shuts down
        if (wasReady) return database;
        if (this.closed) return Promise.reject(new Error('the runtime was destroyed'));
        return Promise.race([database, this.closing]);
    }

    /// Ask the platform for the database now instead of when a task first needs it, e.g. for an app that shows whether
    /// it is ready
    prepare(): void {
        if (this.provider == null) return;
        void this.get().catch(() => { });
    }

    /// The runtime shuts down: a wait for a database that never came up ends
    close(): void {
        if (this.closed) return;
        this.closed = true;
        this.rejectClosing?.(new Error('the runtime was destroyed'));
        this.listeners.clear();
    }

    private setReady(ready: boolean): void {
        if (this.isReady === ready) return;
        this.isReady = ready;
        for (const listener of [...this.listeners]) listener();
    }
}
