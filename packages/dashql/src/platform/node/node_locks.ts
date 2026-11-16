// The Web Locks of one process: what the query result cache and the instances of the embedded Hyper use of `LockManager`.
// In the browser the locks of the origin span the windows of the app. In Node they span only the process, so a folder
// that another process uses at the same time is not protected (docs/wip/dashql_runtime.md).

type LockMode = 'exclusive' | 'shared';

interface LockRequest {
    mode: LockMode;
    grant: () => void;
}

interface LockState {
    held: LockMode[];
    queue: LockRequest[];
}

interface LockOptions {
    mode?: LockMode;
    ifAvailable?: boolean;
    signal?: AbortSignal;
}

type LockCallback<T> = (lock: { name: string; mode: LockMode } | null) => T | Promise<T>;

export class ProcessLockManager {
    private readonly locks = new Map<string, LockState>();

    private state(name: string): LockState {
        let state = this.locks.get(name);
        if (state == null) {
            state = { held: [], queue: [] };
            this.locks.set(name, state);
        }
        return state;
    }

    /// Can a lock of the mode be granted right now? Requests in the queue come first.
    private grantable(state: LockState, mode: LockMode): boolean {
        if (mode === 'exclusive') return state.held.length === 0;
        return !state.held.includes('exclusive') && !state.queue.some(request => request.mode === 'exclusive');
    }

    /// Grant the waiting requests in order, shared requests together
    private drain(name: string, state: LockState): void {
        while (state.queue.length > 0) {
            const next = state.queue[0];
            const free = next.mode === 'exclusive' ? state.held.length === 0 : !state.held.includes('exclusive');
            if (!free) break;
            state.queue.shift();
            state.held.push(next.mode);
            next.grant();
        }
        if (state.held.length === 0 && state.queue.length === 0) this.locks.delete(name);
    }

    request<T>(name: string, callback: LockCallback<T>): Promise<T>;
    request<T>(name: string, options: LockOptions, callback: LockCallback<T>): Promise<T>;
    async request<T>(name: string, optionsOrCallback: LockOptions | LockCallback<T>, maybeCallback?: LockCallback<T>): Promise<T> {
        const options = typeof optionsOrCallback === 'function' ? {} : optionsOrCallback;
        const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback!;
        const mode = options.mode ?? 'exclusive';
        const state = this.state(name);
        if (this.grantable(state, mode)) {
            state.held.push(mode);
        } else if (options.ifAvailable) {
            if (state.held.length === 0 && state.queue.length === 0) this.locks.delete(name);
            return await callback(null);
        } else {
            await new Promise<void>((resolve, reject) => {
                const request = { mode, grant: resolve };
                state.queue.push(request);
                options.signal?.addEventListener('abort', () => {
                    const index = state.queue.indexOf(request);
                    if (index < 0) return;
                    state.queue.splice(index, 1);
                    reject(options.signal!.reason ?? new DOMException('The lock request was aborted', 'AbortError'));
                    this.drain(name, state);
                }, { once: true });
            });
        }
        try {
            return await callback({ name, mode });
        } finally {
            state.held.splice(state.held.indexOf(mode), 1);
            this.drain(name, state);
        }
    }
}

/// The locks of this process, shared by everything in it that keeps files in the root of the app
export const PROCESS_LOCKS = new ProcessLockManager();
