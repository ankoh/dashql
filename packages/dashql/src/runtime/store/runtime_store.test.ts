import { describe, expect, it, vi } from 'vitest';

import type * as core from '../../core/index.js';
import { HandleTable } from './handles.js';
import { RuntimeStore, type RuntimeViewSource, type ViewProjection } from './runtime_store.js';
import type { UpdateScheduler } from './update_scheduler.js';

/// A scheduler that flushes only when the test says so
const MANUAL: UpdateScheduler = { afterTask: () => { }, beforeFrame: () => 0, cancelFrame: () => { } };

/// A runtime that hands out the changes and the views that the test sets, and hears the slices that the store asks for
/// again
class FakeSource implements RuntimeViewSource {
    changes: core.SliceChange[] = [];
    effects: core.HandleEffect[] = [];
    readonly views_ = new Map<string, unknown>();
    readonly resynced: string[] = [];
    readonly reads: string[] = [];

    takeChanges(): core.ChangeSet {
        const changes = this.changes;
        const effects = this.effects;
        this.changes = [];
        this.effects = [];
        return { changes, effects };
    }

    views<K extends core.ViewKind>(kind: K, ids: core.ViewId<K>[]): (core.ViewOf<K> | core.BusyView | null)[] {
        this.reads.push(kind);
        return ids.map(id => (this.views_.get(`${kind}:${String(id)}`) ?? null) as core.ViewOf<K> | core.BusyView | null);
    }

    resync(kind: core.ViewKind, ids: core.ViewId<core.ViewKind>[]): void {
        for (const id of ids) this.resynced.push(`${kind}:${String(id)}`);
    }

    /// A slice moves to a view
    set(kind: core.ViewKind, id: string | number, revision: number, view: unknown): void {
        this.views_.set(`${kind}:${String(id)}`, view);
        this.changes.push({ kind, id, revision });
    }
}

describe('RuntimeStore', () => {
    it('reads the views of a kind once per flush, in the order of the changes', () => {
        const source = new FakeSource();
        const store = new RuntimeStore(new HandleTable(), MANUAL);
        store.attach(source);
        source.set('workbookDerived', 'w1', 2, { scriptKeys: [] });
        source.set('workbook', 'w1', 3, { name: 'second' });
        source.set('workbookDerived', 'w2', 4, { scriptKeys: [] });
        store.flush();
        expect(source.reads).toEqual(['workbookDerived', 'workbook']);
        expect(store.ids('workbookDerived')).toEqual(['w1', 'w2']);
    });

    it('keeps the view of a slice whose projection throws and asks the runtime for it again', () => {
        const source = new FakeSource();
        const errors: string[] = [];
        const store = new RuntimeStore(new HandleTable(), MANUAL, message => errors.push(message));
        let fail = false;
        const projection: ViewProjection<'connection', unknown> = {
            project: (_id, _prev, view) => {
                if (fail) throw new Error('the projection failed');
                return view;
            },
        };
        store.attach(source, { connection: projection } as never);
        source.set('connection', 'a', 1, { name: 'a1' });
        source.set('connection', 'b', 1, { name: 'b1' });
        store.flush();

        // The projection of one slice throws: it keeps its view, the other slices of the flush are projected
        fail = true;
        source.set('connection', 'a', 2, { name: 'a2' });
        source.set('workbook', 'w', 2, { name: 'w2' });
        store.flush();
        expect(store.get('connection', 'a')).toEqual({ name: 'a1' });
        expect(store.get('workbook', 'w')).toEqual({ name: 'w2' });
        expect(source.resynced).toEqual(['connection:a']);
        expect(errors).toHaveLength(1);

        // The runtime reports the slice again, it comes back
        fail = false;
        source.set('connection', 'a', 2, { name: 'a2' });
        store.flush();
        expect(store.get('connection', 'a')).toEqual({ name: 'a2' });

        // A slice that keeps failing is asked for a few times, then the store drops it until its next change
        fail = true;
        for (let revision = 3; revision < 7; ++revision) {
            source.set('connection', 'b', revision, { name: `b${revision}` });
            store.flush();
            if (revision < 6) expect(store.get('connection', 'b')).toEqual({ name: 'b1' });
        }
        expect(source.resynced.filter(slice => slice === 'connection:b')).toHaveLength(3);
        expect(store.get('connection', 'b')).toBeNull();
        fail = false;
        source.set('connection', 'b', 7, { name: 'b7' });
        store.flush();
        expect(store.get('connection', 'b')).toEqual({ name: 'b7' });
    });

    it('keeps the views of a kind whose read throws', () => {
        const source = new FakeSource();
        const store = new RuntimeStore(new HandleTable(), MANUAL, () => { });
        store.attach(source);
        source.set('workbook', 'w', 1, { name: 'w1' });
        store.flush();
        const views = source.views.bind(source);
        source.views = (() => { throw new Error('the views failed'); }) as typeof source.views;
        source.set('workbook', 'w', 2, { name: 'w2' });
        store.flush();
        expect(store.get('workbook', 'w')).toEqual({ name: 'w1' });
        expect(source.resynced).toEqual(['workbook:w']);
        source.views = views;
        source.set('workbook', 'w', 2, { name: 'w2' });
        store.flush();
        expect(store.get('workbook', 'w')).toEqual({ name: 'w2' });
    });

    it('keeps the view of a slice that reads as busy, and drops a slice that went or reads as null', () => {
        const source = new FakeSource();
        const store = new RuntimeStore(new HandleTable(), MANUAL);
        store.attach(source);
        source.set('workbook', 'w', 1, { name: 'w1' });
        source.set('workbook', 'v', 1, { name: 'v1' });
        store.flush();
        // Busy: the slice moved but a task holds it, the runtime reports it again
        source.set('workbook', 'w', 2, 'busy');
        store.flush();
        expect(store.get('workbook', 'w')).toEqual({ name: 'w1' });
        // Gone: the change says so, or the view is null
        source.changes.push({ kind: 'workbook', id: 'w', revision: null });
        source.views_.delete('workbook:v');
        source.changes.push({ kind: 'workbook', id: 'v', revision: 2 });
        store.flush();
        expect(store.get('workbook', 'w')).toBeNull();
        expect(store.get('workbook', 'v')).toBeNull();
        expect(store.ids('workbook')).toEqual([]);
    });

    it('closes at once and forgets a handle only once no view of the store names it', () => {
        const source = new FakeSource();
        const handles = new HandleTable();
        const store = new RuntimeStore(handles, MANUAL, () => { });
        let fail = false;
        const projection: ViewProjection<'connection', unknown> = {
            project: (_id, _prev, view) => {
                if (fail) throw new Error('the projection failed');
                return view;
            },
        };
        store.attach(source, { connection: projection } as never);
        const channel = { close: vi.fn() };
        const handle = handles.register(channel);
        const table = handles.register('a table');
        source.set('connection', 'c', 1, { channel: handle });
        source.set('connection', 'd', 1, { table });
        store.flush();

        // The connection drops its channel while its slice is busy: the channel closes, the handle stays
        source.set('connection', 'c', 2, 'busy');
        source.effects.push({ type: 'close', handle });
        store.flush();
        expect(channel.close).toHaveBeenCalledTimes(1);
        expect(store.get('connection', 'c')).toEqual({ channel: handle });
        expect(handles.get(handle)).toBe(channel);

        // A projection that fails keeps the view with the table, its release waits as well
        fail = true;
        source.set('connection', 'c', 3, { channel: null });
        source.set('connection', 'd', 2, { table: null });
        source.effects.push({ type: 'release', handle: table });
        store.flush();
        expect(handles.get(handle)).toBe(channel);
        expect(handles.get(table)).toBe('a table');

        // Once every view is current the handles go
        fail = false;
        source.set('connection', 'c', 3, { channel: null });
        source.set('connection', 'd', 2, { table: null });
        store.flush();
        expect(store.get('connection', 'c')).toEqual({ channel: null });
        expect(handles.get(handle)).toBeUndefined();
        expect(handles.get(table)).toBeUndefined();
        expect(handles.size).toBe(0);
    });
});
