import type * as core from '../../core/index.js';

import type { HandleTable } from './handles.js';
import type { QueryExecutionState } from '../../platform/query/query_execution_state.js';
import type { ScriptData, WorkbookDerived, WorkbookScripts } from '../../platform/workbook/scripts/workbook_scripts.js';
import { RevisionCache, share } from './projection.js';
import type { UpdateScheduler } from './update_scheduler.js';

/// What the store reads: the runtime of the module
export interface RuntimeViewSource {
    takeChanges(): core.ChangeSet;
    views<K extends core.ViewKind>(kind: K, ids: core.ViewId<K>[], known?: core.KnownKeys<K>): (core.ViewOf<K> | null)[];
    /// The store failed to project slices, they move with the next changes
    resync(kind: core.ViewKind, ids: core.ViewId<core.ViewKind>[]): void;
}

/// The order in which the store projects the kinds of a flush: a kind after the kinds it reads, e.g. the scripts and
/// the derived views of a workbook after the workbook
export const VIEW_KIND_ORDER: readonly core.ViewKind[] = [
    'computation', 'connectionList', 'connection', 'history', 'query', 'workbookList', 'workbook', 'script', 'workbookDerived', 'storage', 'run',
];

/// How often a slice whose projection fails is asked for again before the store gives up on it until it changes
const RESYNC_ATTEMPTS = 3;

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
    query: QueryExecutionState;
    script: ScriptData;
    workbook: WorkbookScripts;
    workbookDerived: WorkbookDerived;
}

/// What the store keeps of a slice of a kind
export type StoreView<K extends core.ViewKind> = K extends keyof ProjectedViews ? ProjectedViews[K] : core.ViewOf<K>;

/// The projections of the kinds, the others are shared with their previous view
type Projections = { [K in core.ViewKind]?: ViewProjection<K, StoreView<K>> };

/// The views of the runtime as the app reads them (docs/design/dashql_runtime.md).
///
/// The runtime tells the store that its state changed (`changed`). The store flushes at the end of the task when the
/// change is urgent, before the next frame otherwise: it takes the changed slices and the effects on handles, applies
/// the effects to the handle table, reads the views of each changed kind with one call in a fixed order of the kinds
/// (`VIEW_KIND_ORDER`), shares each view with the previous one of its slice and notifies the subscribers of the changed
/// slices only. A slice keeps its view while its revision doesn't move. Reads never cross into the module.
///
/// A flush is all or nothing per slice: a kind whose views can't be read and a slice whose projection throws keep
/// their previous views, and the runtime is asked for them again (`resync`), at most `RESYNC_ATTEMPTS` times in a
/// row. A slice that reads as null while the runtime names it busy keeps its view, the runtime reports it again.
export class RuntimeStore {
    private source: RuntimeViewSource | null = null;
    /// The projections of the kinds
    private projections: Projections = {};
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
    /// The failed projections of slices in a row
    private readonly failures = new Map<string, number>();

    constructor(
        private readonly handles: HandleTable,
        private readonly scheduler: UpdateScheduler,
        /// Hears the failures of projections, e.g. the logger of the runtime
        private readonly logger: ((message: string) => void) | null = null,
    ) { }

    /// Read the views of a runtime with the projections of the kinds
    attach(source: RuntimeViewSource, projections: Projections = {}): void {
        this.source = source;
        this.projections = projections;
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

        // The changes by kind, projected in the order of the kinds
        const byKind = new Map<core.ViewKind, core.SliceChange[]>();
        for (const change of changes.changes) {
            let list = byKind.get(change.kind);
            if (list == null) {
                list = [];
                byKind.set(change.kind, list);
            }
            list.push(change);
        }
        const kinds = [...VIEW_KIND_ORDER.filter(kind => byKind.has(kind)), ...[...byKind.keys()].filter(kind => !VIEW_KIND_ORDER.includes(kind))];
        const notify: string[] = [];
        for (const kind of kinds) {
            const list = byKind.get(kind)!;
            let cache = this.caches.get(kind);
            if (cache == null) {
                cache = new RevisionCache();
                this.caches.set(kind, cache);
            }
            const present = list.filter(change => change.revision != null);
            const projection = this.projections[kind] as ViewProjection<typeof kind, unknown> | undefined;
            const ids = present.map(change => change.id) as core.ViewId<typeof kind>[];
            const failed: core.ViewId<typeof kind>[] = [];
            let views: (core.ViewOf<typeof kind> | null)[] = [];
            try {
                const known = projection?.known?.(ids, ids.map(id => cache.peek(id) ?? null));
                views = present.length === 0 ? [] : source.views(kind, ids, known);
            } catch (e) {
                // The slices of the kind keep their views
                this.failed(source, kind, ids, e);
                views = [];
                present.length = 0;
            }
            present.forEach((change, i) => {
                const view = views[i] ?? null;
                // A slice that is busy reads as null, the runtime reports it again
                if (view == null) return;
                try {
                    cache.get(change.id, change.revision!, prev => projection == null ? share(prev, view) : projection.project(change.id, prev, view));
                    this.failures.delete(sliceKey(kind, change.id));
                } catch (e) {
                    failed.push(change.id);
                    this.logger?.(`the projection of the slice ${sliceKey(kind, change.id)} failed: ${String(e)}`);
                }
            });
            if (failed.length > 0) this.failed(source, kind, failed, null);
            for (const change of list) {
                if (change.revision == null) {
                    this.failures.delete(sliceKey(kind, change.id));
                    this.release(kind, change.id);
                }
                notify.push(sliceKey(kind, change.id));
            }
            this.maps.delete(kind);
        }
        for (const key of notify) {
            for (const listener of [...(this.listeners.get(key) ?? [])]) listener();
        }
        for (const kind of kinds) {
            for (const listener of [...(this.kindListeners.get(kind) ?? [])]) listener();
        }
    };

    /// Slices that the store failed to project keep their views, the runtime is asked for them again a few times
    private failed(source: RuntimeViewSource, kind: core.ViewKind, ids: core.ViewId<core.ViewKind>[], error: unknown): void {
        if (error != null) this.logger?.(`the views of ${kind} failed: ${String(error)}`);
        const again = ids.filter(id => {
            const key = sliceKey(kind, id);
            const attempts = (this.failures.get(key) ?? 0) + 1;
            this.failures.set(key, attempts);
            return attempts <= RESYNC_ATTEMPTS;
        });
        if (again.length === 0) return;
        try {
            source.resync(kind, again);
        } catch (e) {
            this.logger?.(`the runtime can't report ${kind} again: ${String(e)}`);
        }
    }

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
