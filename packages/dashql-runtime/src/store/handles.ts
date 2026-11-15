import type * as core from '@ankoh/dashql-core';

/// The handles of the JavaScript objects that the Rust runtime names by a number (docs/wip/runtime_projection.md): the
/// channels of the connections, the records of catalog updates and queries, the Arrow tables of results and
/// computations, the lifetimes of computations.
///
/// The adapter registers an object and hands its handle over with the action that gives the object to a state. From
/// then on the state owns the handle: it keeps the handle where it keeps the object and lets go of it with an effect,
/// also right away when the action didn't take it. An action that throws leaves the handle with the adapter, which
/// releases it. The effects on handles are three, `apply` runs them and returns the effects of the state that are no
/// effects on handles.

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

function isHandleEffect(effect: { type: string }): effect is HandleEffect {
    return effect.type === 'release' || effect.type === 'close' || effect.type === 'abort';
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

    /// Close the object of a handle and forget it
    close(handle: number): void {
        const object = this.objects.get(handle) as Closable | null | undefined;
        this.objects.delete(handle);
        object?.close?.();
    }

    /// Abort the object of a handle with a reason, the handle stays until a release
    abort(handle: number, reason: string): void {
        const object = this.objects.get(handle) as Abortable | null | undefined;
        // A token without an abort, e.g. the lifetime of a computation, is aborted by its release
        object?.abort?.(new DOMException(reason, 'AbortError'));
    }

    /// Run the effects on handles in order, returns the other effects in order
    apply<E extends { type: string }>(effects: readonly E[]): Exclude<E, HandleEffect>[] {
        const rest: Exclude<E, HandleEffect>[] = [];
        for (const effect of effects) {
            if (!isHandleEffect(effect)) {
                rest.push(effect as Exclude<E, HandleEffect>);
                continue;
            }
            switch (effect.type) {
                case 'release':
                    this.release(effect.handle);
                    break;
                case 'close':
                    this.close(effect.handle);
                    break;
                case 'abort':
                    this.abort(effect.handle, effect.reason);
                    break;
            }
        }
        return rest;
    }

    /// The number of objects in the table
    get size(): number {
        return this.objects.size;
    }
}

/// The handle tables of the core instances, one per runtime
const tables = new WeakMap<core.DashQL, HandleTable>();

/// The handle table of the runtime of a core instance: the connections, the query histories and the computations of
/// an instance share it
export function handlesOf(instance: core.DashQL): HandleTable {
    let table = tables.get(instance);
    if (table == null) {
        table = new HandleTable();
        tables.set(instance, table);
    }
    return table;
}
