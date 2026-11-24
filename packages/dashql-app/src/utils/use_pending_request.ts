import * as React from 'react';

/// The request that a dialog answers, e.g. for a dot command of the shell that waits until the user closes the dialog
export interface PendingRequest<Args, Result> {
    /// The arguments and the signal of the pending request, null while none is pending
    readonly pending: { readonly args: Args; readonly signal?: AbortSignal } | null;
    /// Start a request. It settles with `resolve`, or with the result of a dismissed request on `dismiss`, when its
    /// signal aborts or when the component unmounts. A request fails while another one is pending.
    request(args: Args, signal?: AbortSignal): Promise<Result>;
    /// Settle the pending request with a result, false if none is pending
    resolve(result: Result): boolean;
    /// Settle the pending request with the result of a dismissed request
    dismiss(): void;
}

interface PendingEntry<Result> {
    resolve: (result: Result) => void;
    signal?: AbortSignal;
    onAbort: () => void;
}

/// One pending request at a time, `name` names it in the error of a second request, `dismissed` is the result of a
/// dismissed request
export function usePendingRequest<Args, Result>(name: string, dismissed: Result): PendingRequest<Args, Result> {
    const [pending, setPending] = React.useState<{ args: Args; signal?: AbortSignal } | null>(null);
    const entryRef = React.useRef<PendingEntry<Result> | null>(null);

    const resolve = React.useCallback((result: Result) => {
        const entry = entryRef.current;
        if (entry == null) return false;
        entryRef.current = null;
        entry.signal?.removeEventListener('abort', entry.onAbort);
        setPending(null);
        entry.resolve(result);
        return true;
    }, []);
    const dismiss = React.useCallback(() => { resolve(dismissed); }, [dismissed, resolve]);

    const request = React.useCallback((args: Args, signal?: AbortSignal) => {
        if (entryRef.current != null) return Promise.reject(new Error(`A ${name} request is already pending.`));
        if (signal?.aborted) return Promise.resolve(dismissed);
        setPending({ args, signal });
        return new Promise<Result>(settle => {
            const entry: PendingEntry<Result> = { resolve: settle, signal, onAbort: dismiss };
            entryRef.current = entry;
            signal?.addEventListener('abort', entry.onAbort, { once: true });
        });
    }, [dismiss, dismissed, name]);

    // Only the unmount dismisses, a new dismissed result of a render must not
    const dismissOnUnmount = React.useEffectEvent(() => dismiss());
    React.useEffect(() => () => dismissOnUnmount(), []);

    return React.useMemo(() => ({ pending, request, resolve, dismiss }), [dismiss, pending, request, resolve]);
}
