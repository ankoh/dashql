/// The projection of the Rust state into the objects that the app reads, see docs/design/dashql_runtime.md.
///
/// A view of a slice of the Rust state is a fresh JS object with every read. `share` keeps the objects of the previous
/// view where the next one is equal, so a part of a view that didn't change keeps its identity, and so does every
/// object that the app builds from that part. `RevisionCache` keeps the projection of a slice while its revision
/// doesn't move. Views are never written to once they are projected.

/// Is a value a plain object of a view? The module may belong to another realm, e.g. a frame that shares it, so its
/// objects have the `Object.prototype` of that realm.
function isPlainObject(value: object): value is Record<string, unknown> {
    const prototype = Object.getPrototypeOf(value);
    return prototype === null || Object.getPrototypeOf(prototype) === null;
}

/// The previous value where the next one is equal. Equal primitives stay, arrays and plain objects whose members all
/// stay return the previous object, other objects (typed arrays, class instances) compare by identity. The next value
/// is fresh from a read of the Rust state, its members are replaced in place.
export function share<T>(prev: T | null | undefined, next: T): T {
    if (prev === next || prev == null || next == null || typeof prev !== 'object' || typeof next !== 'object') {
        return next;
    }
    if (Array.isArray(next)) {
        if (!Array.isArray(prev)) return next;
        let same = prev.length === next.length;
        for (let i = 0; i < next.length; ++i) {
            const shared = share(prev[i], next[i]);
            next[i] = shared;
            same = same && shared === prev[i];
        }
        return same ? prev : next;
    }
    if (!isPlainObject(next) || Array.isArray(prev) || !isPlainObject(prev)) return next;
    const target: Record<string, unknown> = next;
    const keys = Object.keys(target);
    let same = keys.length === Object.keys(prev).length;
    for (const key of keys) {
        const shared = share(prev[key], target[key]);
        target[key] = shared;
        same = same && key in prev && shared === prev[key];
    }
    return same ? prev : next;
}

/// The projections of the slices of a Rust state by id, each kept while the revision of its slice doesn't move
export class RevisionCache<K, V> {
    private readonly entries = new Map<K, { revision: number; value: V }>();

    /// The projection of a slice, built again when its revision moved. The build gets the previous projection.
    get(id: K, revision: number, build: (prev: V | null) => V): V {
        const entry = this.entries.get(id);
        if (entry != null && entry.revision === revision) return entry.value;
        const value = build(entry?.value ?? null);
        this.entries.set(id, { revision, value });
        return value;
    }

    /// The projection of a slice, undefined without one
    peek(id: K): V | undefined {
        return this.entries.get(id)?.value;
    }

    /// Forget a slice
    delete(id: K): void {
        this.entries.delete(id);
    }

    /// The ids of the slices
    keys(): IterableIterator<K> {
        return this.entries.keys();
    }
}
