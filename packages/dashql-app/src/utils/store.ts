/// The next state of a store, or a function that derives it from the current one
export type StoreAction<T> = T | ((prev: T) => T);

/// A state container outside of React.
///
/// React may invoke the updater of a state hook more than once, e.g. when it rebases updates or
/// double-invokes them in strict mode. The registries free Wasm objects and schedule storage writes
/// while they reduce, so their updates must run exactly once. A store applies every update right
/// away, synchronously and in call order, and notifies its subscribers afterwards.
/// The hooks that bind a store to React are in store_hooks.ts.
export class Store<T> {
    /// The current state
    current: T;
    /// The subscribers
    private readonly listeners: Set<() => void>;

    constructor(initial: T) {
        this.current = initial;
        this.listeners = new Set();
    }

    /// Subscribe to state changes
    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    };

    /// Get the current state
    get = (): T => this.current;

    /// Replace the state or derive it from the current one. The updater runs exactly once.
    update = (action: StoreAction<T>): void => {
        const next = typeof action === 'function'
            ? (action as (prev: T) => T)(this.current)
            : action;
        if (Object.is(next, this.current)) return;
        this.current = next;
        for (const listener of this.listeners) {
            listener();
        }
    };
}

/// Decides when an update queue applies its updates
export interface UpdateScheduler {
    /// Run the callback at the end of the current task
    afterTask(callback: () => void): void;
    /// Run the callback once before the next frame, returns the handle that cancels it
    beforeFrame(callback: () => void): unknown;
    /// Cancel a callback of beforeFrame
    cancelFrame(handle: unknown): void;
}

/// Schedules without frames, where nothing renders: updates that may wait for a frame wait for the next task
export const TASK_UPDATE_SCHEDULER: UpdateScheduler = {
    afterTask: callback => queueMicrotask(callback),
    beforeFrame: callback => setTimeout(callback, 0),
    cancelFrame: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/// Batches the updates of a store and applies them in a single store update, in the order they were pushed.
///
/// Updates are applied at the end of the current task. Updates that may wait for the next frame, e.g.
/// the progress of a result stream, are applied once per frame. An update that must not wait applies
/// the queued updates right away to preserve their order.
export class UpdateQueue<T> {
    /// The store
    private readonly store: Store<T>;
    /// The scheduler
    private readonly scheduler: UpdateScheduler;
    /// The pending updates
    private pending: Array<(state: T) => T>;
    /// The scheduled flush
    private scheduled: { type: 'task' } | { type: 'frame'; handle: unknown } | null;

    constructor(store: Store<T>, scheduler: UpdateScheduler) {
        this.store = store;
        this.scheduler = scheduler;
        this.pending = [];
        this.scheduled = null;
    }

    /// Queue an update
    push(update: (state: T) => T, waitForFrame: boolean = false): void {
        this.pending.push(update);
        if (waitForFrame) {
            if (this.scheduled == null) {
                this.scheduled = { type: 'frame', handle: this.scheduler.beforeFrame(this.flush) };
            }
        } else if (this.scheduled?.type === 'frame') {
            this.scheduler.cancelFrame(this.scheduled.handle);
            this.flush();
        } else if (this.scheduled == null) {
            this.scheduled = { type: 'task' };
            this.scheduler.afterTask(this.flush);
        }
    }

    /// Apply the pending updates. An update that throws is skipped, the others still apply.
    flush = (): void => {
        this.scheduled = null;
        const pending = this.pending;
        if (pending.length === 0) return;
        this.pending = [];
        this.store.update(state => pending.reduce((s, update) => {
            try {
                return update(s);
            } catch (e: unknown) {
                console.error('Store update failed', e);
                return s;
            }
        }, state));
    };

    /// Drop the pending updates
    dispose(): void {
        if (this.scheduled?.type === 'frame') {
            this.scheduler.cancelFrame(this.scheduled.handle);
        }
        this.scheduled = null;
        this.pending = [];
    }
}
