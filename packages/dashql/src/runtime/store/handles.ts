/// The handles of the JavaScript objects that the Rust runtime names by a number (docs/design/dashql_runtime.md): the
/// channels of the connections, the records of catalog updates and of the queries that the host runs, the Arrow tables
/// of results and computations, the lifetimes of computations. The handle table is the one of the platform of the
/// runtime (`Runtime.handles`).
///
/// The adapter registers an object and hands its handle over with the action that gives the object to a state. From
/// then on the runtime owns the handle, also when it refuses the action: the state keeps the handle where it keeps the
/// object and lets go of it with an effect, a refused action releases it. The adapter never releases a handle that it
/// handed over. The effects on handles are three: the runtime aborts and closes at once through `abort` and `close`,
/// a closed object keeps its handle until the release. Releases wait for the store, which runs the effects that are
/// left with `apply` and forgets the handles once no view of the store names them.

/// An effect of a state on a handle
export type HandleEffect =
    | { type: 'release'; handle: number }
    | { type: 'close'; handle: number }
    | { type: 'abort'; handle: number; reason: string };

/// An object that an abort reaches, e.g. an `AbortController` or the record of a query
export interface Abortable {
    abort?(reason?: unknown): void;
}

/// An object that a close reaches, e.g. a channel
export interface Closable {
    close?(): unknown;
}

/// The handle table of a runtime. A handle is never given out twice, releasing an unknown handle does nothing.
export class HandleTable {
    private nextHandle = 1;
    private readonly objects = new Map<number, unknown>();

    /// Keep an object under a new handle
    register(object: unknown): number {
        const handle = this.nextHandle++;
        this.objects.set(handle, object);
        return handle;
    }

    /// Keep the object of a handle under a new handle as well, e.g. a result table that a computation takes too
    duplicate(handle: number): number {
        if (!this.objects.has(handle)) throw new Error(`the handle ${handle} is unknown`);
        return this.register(this.objects.get(handle));
    }

    /// Replace the object of a handle, e.g. a table that was built under its handle
    set(handle: number, object: unknown): void {
        if (this.objects.has(handle)) this.objects.set(handle, object);
    }

    /// The object of a handle, undefined for none or one that was released
    get<T>(handle: number | null | undefined): T | undefined {
        return handle == null ? undefined : (this.objects.get(handle) as T | undefined);
    }

    /// Forget the object of a handle
    release(handle: number): void {
        this.objects.delete(handle);
    }

    /// Close the object of a handle, the handle stays until its release
    close(handle: number): void {
        const object = this.objects.get(handle) as Closable | null | undefined;
        object?.close?.();
    }

    /// Abort the object of a handle with a reason, the handle stays until a release
    abort(handle: number, reason: string): void {
        const object = this.objects.get(handle) as Abortable | null | undefined;
        // A token without an abort, e.g. the lifetime of a computation, is aborted by its release
        object?.abort?.(new DOMException(reason, 'AbortError'));
    }

    /// Run the aborts and the closes in order, returns the handles to release in order: the released and the closed
    /// ones. An object that throws on its close or abort is released as the effect says, the effects after it still run.
    apply(effects: readonly HandleEffect[]): number[] {
        const releases: number[] = [];
        for (const effect of effects) {
            if (effect.type !== 'abort') releases.push(effect.handle);
            try {
                if (effect.type === 'close') this.close(effect.handle);
                if (effect.type === 'abort') this.abort(effect.handle, effect.reason);
            } catch (e) {
                console.warn(`the ${effect.type} of the handle ${effect.handle} failed`, e);
            }
        }
        return releases;
    }

    /// The number of objects in the table
    get size(): number {
        return this.objects.size;
    }
}
