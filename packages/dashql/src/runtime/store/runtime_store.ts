import type * as core from '../../core/index.js';

import type { HandleTable } from './handles.js';
import type { QueryExecutionState } from '../../platform/query/query_execution_state.js';
import type { ScriptData, WorkbookDerived, WorkbookScripts } from '../../platform/workbook/workbook_scripts.js';
import { RevisionCache, share } from './projection.js';
import type { UpdateScheduler } from './update_scheduler.js';

/// What the store reads: the runtime of the module
export interface RuntimeViewSource {
    takeChanges(): core.ChangeSet;
    views<K extends core.ViewKind>(kind: K, ids: core.ViewId<K>[], known?: core.KnownKeys<K>): (core.ViewOf<K> | core.BusyView | null)[];
    /// The store failed to project slices, they move with the next changes
    resync(kind: core.ViewKind, ids: core.ViewId<core.ViewKind>[]): void;
}

/// How often a slice whose projection fails is asked for again before the store drops it until it changes
export const RESYNC_ATTEMPTS = 3;

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
/// change is urgent, before the next frame otherwise: it takes the changed slices and the effects on handles, aborts
/// and closes at once, reads the views of each changed kind with one call in the order of the changes, shares each
/// view with the previous one of its slice and notifies the subscribers of the changed slices only. A slice keeps its
/// view while its revision doesn't move. Reads never cross into the module.
///
/// A flush is all or nothing per slice: a kind whose views can't be read and a slice whose projection throws keep
/// their previous views, and the runtime is asked for them again (`resync`), at most `RESYNC_ATTEMPTS` times in a
/// row; then the store drops the slice until it changes. A slice that reads as busy keeps its view, the runtime
/// reports it again. A view that reads as null is gone.
///
/// No view of the store names a released handle: the releases, and the handles of closed objects, are forgotten after
/// the views of the flush, and wait while a slice keeps an older view, busy or asked for again.
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
    /// The handles to forget once no view of the store names them
    private releases: number[] = [];
    /// Those who wait for the next flush (`afterFlush`)
    private waiting: (() => void)[] = [];

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

    /// Resolves once the store took the changes that are scheduled now, e.g. those of an action: after the next flush,
    /// at once when no flush is scheduled. The views of the store then show the changes.
    afterFlush(): Promise<void> {
        if (this.scheduled == null || this.disposed) return Promise.resolve();
        return new Promise(resolve => this.waiting.push(resolve));
    }

    /// Take the changes of the runtime now, e.g. after a command or in the command line tool
    flush = (): void => {
        const waiting = this.waiting;
        this.waiting = [];
        try {
            this.take();
        } finally {
            for (const resolve of waiting) resolve();
        }
    };

    private take(): void {
        if (this.scheduled?.type === 'frame') this.scheduler.cancelFrame(this.scheduled.handle);
        this.scheduled = null;
        const source = this.source;
        if (source == null || this.disposed) return;
        const changes = source.takeChanges();
        // Aborts and closes apply at once, the handles are forgotten once no view names them
        this.releases.push(...this.handles.apply(changes.effects));
        // Does a slice keep an older view after the flush?
        let behind = false;

        // The changes by kind, in the order of the changes
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
        const notifyKinds = new Set<core.ViewKind>();
        const changed = (kind: core.ViewKind, id: unknown) => {
            notify.push(sliceKey(kind, id));
            notifyKinds.add(kind);
            this.maps.delete(kind);
        };
        for (const [kind, list] of byKind) {
            let cache = this.caches.get(kind);
            if (cache == null) {
                cache = new RevisionCache();
                this.caches.set(kind, cache);
            }
            const present = list.filter(change => change.revision != null);
            const projection = this.projections[kind] as ViewProjection<typeof kind, unknown> | undefined;
            const ids = present.map(change => change.id) as core.ViewId<typeof kind>[];
            const failed: core.ViewId<typeof kind>[] = [];
            let views: (core.ViewOf<typeof kind> | core.BusyView | null)[] = [];
            try {
                const known = projection?.known?.(ids, ids.map(id => cache.peek(id) ?? null));
                views = present.length === 0 ? [] : source.views(kind, ids, known);
            } catch (e) {
                // The slices of the kind keep their views
                this.logger?.(`the views of ${kind} failed: ${String(e)}`);
                failed.push(...ids);
                present.length = 0;
            }
            present.forEach((change, i) => {
                const view = views[i] ?? null;
                if (view === 'busy') {
                    // The runtime reports the slice again
                    behind = true;
                    return;
                }
                if (view == null) {
                    this.drop(kind, change.id);
                    changed(kind, change.id);
                    return;
                }
                try {
                    cache.get(change.id, change.revision!, prev => projection == null ? share(prev, view) : projection.project(change.id, prev, view));
                    this.failures.delete(sliceKey(kind, change.id));
                    changed(kind, change.id);
                } catch (e) {
                    failed.push(change.id);
                    this.logger?.(`the projection of the slice ${sliceKey(kind, change.id)} failed: ${String(e)}`);
                }
            });
            if (failed.length > 0) {
                const again = this.failed(source, kind, failed);
                behind ||= again.length > 0;
                for (const id of failed.filter(id => !again.includes(id))) {
                    this.drop(kind, id);
                    changed(kind, id);
                }
            }
            for (const change of list) {
                if (change.revision != null) continue;
                this.drop(kind, change.id);
                changed(kind, change.id);
            }
        }
        if (!behind) {
            const releases = this.releases;
            this.releases = [];
            for (const handle of releases) this.handles.release(handle);
        }
        for (const key of notify) {
            for (const listener of [...(this.listeners.get(key) ?? [])]) listener();
        }
        for (const kind of notifyKinds) {
            for (const listener of [...(this.kindListeners.get(kind) ?? [])]) listener();
        }
    }

    /// Slices that the store failed to project keep their views, the runtime is asked for them again a few times.
    /// Returns the slices that were asked for again.
    private failed(source: RuntimeViewSource, kind: core.ViewKind, ids: core.ViewId<core.ViewKind>[]): core.ViewId<core.ViewKind>[] {
        const again = ids.filter(id => {
            const key = sliceKey(kind, id);
            const attempts = (this.failures.get(key) ?? 0) + 1;
            this.failures.set(key, attempts);
            return attempts <= RESYNC_ATTEMPTS;
        });
        if (again.length === 0) return again;
        try {
            source.resync(kind, again);
        } catch (e) {
            this.logger?.(`the runtime can't report ${kind} again: ${String(e)}`);
        }
        return again;
    }

    /// Forget the view of a slice, one that is gone or that the store failed to project too often
    private drop(kind: core.ViewKind, id: core.ViewId<core.ViewKind>): void {
        this.failures.delete(sliceKey(kind, id));
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
        const waiting = this.waiting;
        this.waiting = [];
        for (const resolve of waiting) resolve();
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
