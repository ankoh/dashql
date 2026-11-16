import type * as core from '../../core/index.js';

import type { HandleTable } from './handles.js';
import type { ScriptData, WorkbookDerived, WorkbookScripts } from '../../platform/workbook/scripts/workbook_scripts.js';
import { RevisionCache, share } from './projection.js';
import type { UpdateScheduler } from './store.js';

/// What the store reads: the runtime of the module
export interface RuntimeViewSource {
    takeChanges(): core.ChangeSet;
    views<K extends core.ViewKind>(kind: K, ids: core.ViewId<K>[], known?: core.KnownKeys<K>): (core.ViewOf<K> | null)[];
}

/// What the store keeps of a slice of a kind: the view as it is, shared with the previous one, or what a projection
/// builds from it, e.g. a script with its payloads read
export interface ViewProjection<K extends core.ViewKind, P> {
    /// The keys of the payloads that the store holds of the slices, their bytes don't cross again
    known?(ids: core.ViewId<K>[], held: (P | null)[]): core.KnownKeys<K>;
    /// The projection of a fresh view of a slice
    project(id: core.ViewId<K>, prev: P | null, view: core.ViewOf<K>): P;
    /// The slice is gone
    release?(id: core.ViewId<K>, prev: P): void;
}

/// The kinds that the store keeps as projections
export interface ProjectedViews {
    script: ScriptData;
    workbook: WorkbookScripts;
    workbookDerived: WorkbookDerived;
}

/// What the store keeps of a slice of a kind
export type StoreView<K extends core.ViewKind> = K extends keyof ProjectedViews ? ProjectedViews[K] : core.ViewOf<K>;

/// The structured progress of a query crosses only when its revision or the version of its structure moved
const QUERY_PROJECTION: ViewProjection<'query', core.QueryView> = {
    known: (_ids, views) => views.map(view => {
        const profile = view?.latestProgressUpdate?.profile;
        return profile == null ? null : { revision: profile.revision, structureVersion: profile.structureVersion };
    }),
    project: (_id, prev, next) => {
        const held = prev?.latestProgressUpdate?.profile;
        const profile = next.latestProgressUpdate?.profile;
        if (held != null && profile != null) {
            if (profile.structure == null && held.structureVersion === profile.structureVersion) profile.structure = held.structure;
            if (profile.execution == null && held.revision === profile.revision) profile.execution = held.execution;
        }
        return share(prev, next);
    },
};

/// The projections of the kinds, the others are shared with their previous view
type Projections = { [K in core.ViewKind]?: ViewProjection<K, StoreView<K>> };

/// The views of the runtime as the app reads them (docs/wip/runtime_api.md).
///
/// The runtime tells the store that its state changed (`changed`). The store flushes at the end of the task when the
/// change is urgent, before the next frame otherwise: it takes the changed slices and the effects on handles, applies
/// the effects to the handle table, reads the views of each changed kind with one call, shares each view with the
/// previous one of its slice and notifies the subscribers of the changed slices only. A slice keeps its view while its
/// revision doesn't move. Reads never cross into the module.
export class RuntimeStore {
    private source: RuntimeViewSource | null = null;
    /// The projections of the kinds
    private projections: Projections = { query: QUERY_PROJECTION };
    /// The views of the last flush, a revision cache per kind
    private readonly caches = new Map<core.ViewKind, RevisionCache<core.ViewId<core.ViewKind>, unknown>>();
    /// The subscribers by slice
    private readonly listeners = new Map<string, Set<() => void>>();
    /// The subscribers of all slices of a kind
    private readonly kindListeners = new Map<core.ViewKind, Set<() => void>>();
    /// The views of all slices of a kind, built once per change of the kind
    private readonly maps = new Map<core.ViewKind, Map<unknown, unknown>>();
    /// The scheduled flush
    private scheduled: { type: 'task' } | { type: 'frame'; handle: unknown } | null = null;
    private disposed = false;

    constructor(
        private readonly handles: HandleTable,
        private readonly scheduler: UpdateScheduler,
    ) { }

    /// Read the views of a runtime, with the projections of kinds besides the queries
    attach(source: RuntimeViewSource, projections: Projections = {}): void {
        this.source = source;
        this.projections = { query: QUERY_PROJECTION, ...projections };
    }

    /// The runtime changed, flush at the end of the task when urgent, before the next frame otherwise
    changed = (urgent: boolean): void => {
        if (this.disposed) return;
        if (urgent) {
            if (this.scheduled?.type === 'frame') {
                this.scheduler.cancelFrame(this.scheduled.handle);
                this.scheduled = null;
            }
            if (this.scheduled == null) {
                this.scheduled = { type: 'task' };
                this.scheduler.afterTask(this.flush);
            }
        } else if (this.scheduled == null) {
            this.scheduled = { type: 'frame', handle: this.scheduler.beforeFrame(this.flush) };
        }
    };

    /// Take the changes of the runtime now, e.g. after a command or in the command line tool
    flush = (): void => {
        if (this.scheduled?.type === 'frame') this.scheduler.cancelFrame(this.scheduled.handle);
        this.scheduled = null;
        const source = this.source;
        if (source == null || this.disposed) return;
        const changes = source.takeChanges();
        this.handles.apply(changes.effects);
        if (changes.changes.length === 0) return;

        // The views of each changed kind with one call
        const byKind = new Map<core.ViewKind, core.SliceChange[]>();
        for (const change of changes.changes) {
            let list = byKind.get(change.kind);
            if (list == null) {
                list = [];
                byKind.set(change.kind, list);
            }
            list.push(change);
        }
        const notify: string[] = [];
        for (const [kind, list] of byKind) {
            let cache = this.caches.get(kind);
            if (cache == null) {
                cache = new RevisionCache();
                this.caches.set(kind, cache);
            }
            const present = list.filter(change => change.revision != null);
            const projection = this.projections[kind] as ViewProjection<typeof kind, unknown> | undefined;
            const ids = present.map(change => change.id) as core.ViewId<typeof kind>[];
            const known = projection?.known?.(ids, ids.map(id => cache.peek(id) ?? null));
            const views = present.length === 0 ? [] : source.views(kind, ids, known);
            present.forEach((change, i) => {
                const view = views[i] ?? null;
                if (view == null) {
                    this.release(kind, change.id);
                } else {
                    cache.get(change.id, change.revision!, prev => projection == null ? share(prev, view) : projection.project(change.id, prev, view));
                }
            });
            for (const change of list) {
                if (change.revision == null) this.release(kind, change.id);
                notify.push(sliceKey(kind, change.id));
            }
            this.maps.delete(kind);
        }
        for (const key of notify) {
            for (const listener of [...(this.listeners.get(key) ?? [])]) listener();
        }
        for (const kind of byKind.keys()) {
            for (const listener of [...(this.kindListeners.get(kind) ?? [])]) listener();
        }
    };

    /// Forget a slice that is gone
    private release(kind: core.ViewKind, id: core.ViewId<core.ViewKind>): void {
        const cache = this.caches.get(kind);
        const prev = cache?.peek(id);
        if (prev === undefined) return;
        cache!.delete(id);
        (this.projections[kind] as ViewProjection<typeof kind, unknown> | undefined)?.release?.(id, prev);
    }

    /// The view of a slice of the last flush, null without one
    get<K extends core.ViewKind>(kind: K, id: core.ViewId<K>): StoreView<K> | null {
        return (this.caches.get(kind)?.peek(id) as StoreView<K> | undefined) ?? null;
    }

    /// The ids of the slices of a kind of the last flush
    ids<K extends core.ViewKind>(kind: K): core.ViewId<K>[] {
        return [...(this.caches.get(kind)?.keys() ?? [])] as core.ViewId<K>[];
    }

    /// The views of all slices of a kind of the last flush by id. The map keeps its identity until a slice of the kind
    /// changes.
    all<K extends core.ViewKind>(kind: K): ReadonlyMap<core.ViewId<K>, StoreView<K>> {
        let map = this.maps.get(kind);
        if (map == null) {
            map = new Map();
            const cache = this.caches.get(kind);
            for (const id of cache?.keys() ?? []) map.set(id, cache!.peek(id));
            this.maps.set(kind, map);
        }
        return map as Map<core.ViewId<K>, StoreView<K>>;
    }

    /// Subscribe to the changes of a slice
    subscribe<K extends core.ViewKind>(kind: K, id: core.ViewId<K>, listener: () => void): () => void {
        return subscribeTo(this.listeners, sliceKey(kind, id), listener);
    }

    /// Subscribe to the changes of all slices of a kind, e.g. of every connection
    subscribeKind(kind: core.ViewKind, listener: () => void): () => void {
        return subscribeTo(this.kindListeners, kind, listener);
    }

    /// Stop flushing
    dispose(): void {
        if (this.scheduled?.type === 'frame') this.scheduler.cancelFrame(this.scheduled.handle);
        this.scheduled = null;
        this.disposed = true;
        this.source = null;
    }
}

function subscribeTo<K>(listeners: Map<K, Set<() => void>>, key: K, listener: () => void): () => void {
    let set = listeners.get(key);
    if (set == null) {
        set = new Set();
        listeners.set(key, set);
    }
    set.add(listener);
    return () => {
        set!.delete(listener);
        if (set!.size === 0) listeners.delete(key);
    };
}

function sliceKey(kind: core.ViewKind, id: unknown): string {
    return `${kind}:${String(id)}`;
}
