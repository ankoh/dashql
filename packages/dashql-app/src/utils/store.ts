/// The next state of a store, or a function that derives it from the current one
export type StoreAction<T> = T | ((prev: T) => T);

/// A container of state of the user interface outside of React, e.g. the selection of scripts, the metrics of a Hyper
/// log or the state of an agent session. The state of DashQL is in the runtime, the app reads it from the store of
/// its views (`useView` of `@akohn/dashql-react/hooks`).
///
/// React may invoke the updater of a state hook more than once, e.g. when it rebases updates or double-invokes them in
/// strict mode. A store applies every update exactly once, right away, synchronously and in call order, and notifies
/// its subscribers afterwards.
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
