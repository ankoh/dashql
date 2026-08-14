import * as React from 'react';

type StatePredicate<V> = (v: V) => boolean;

interface StateChangeSubscriber<V> {
    predicate: StatePredicate<V>;
    resolve: (v: V) => void;
    reject: (err: Error) => void;
}

export function useAwaitStateChange<V>(state: V) {
    const subscribers = React.useRef<StateChangeSubscriber<V>[]>([]);

    // Helper to await a state change
    const awaitStateChange = React.useCallback((state: V, predicate: StatePredicate<V>): Promise<V> => {
        // Short-circuit: predicate is already true
        if (predicate(state)) {
            return Promise.resolve(state);
        }
        let resolver: any = null;
        let rejecter: any = null;
        let promise = new Promise<V>((resolve, reject) => {
            resolver = resolve;
            rejecter = reject
        });
        subscribers.current.push({
            predicate,
            resolve: resolver,
            reject: rejecter
        });
        return promise;
    }, []);

    // Re-check all pending predicates with every state update
    React.useEffect(() => {
        let filtered: StateChangeSubscriber<V>[] = [];
        for (let i = 0; i < subscribers.current.length; ++i) {
            const sub = subscribers.current[i];
            if (sub.predicate(state)) {
                sub.resolve(state);
            } else {
                filtered.push(sub);
            }
        }
        subscribers.current = filtered;
    }, [state]);

    return awaitStateChange;
}
