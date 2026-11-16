import { describe, expect, it } from 'vitest';

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
    readonly views_ = new Map<string, unknown>();
    readonly resynced: string[] = [];
    readonly reads: string[] = [];

    takeChanges(): core.ChangeSet {
        const changes = this.changes;
        this.changes = [];
        return { changes, effects: [] };
    }

    views<K extends core.ViewKind>(kind: K, ids: core.ViewId<K>[]): (core.ViewOf<K> | null)[] {
        this.reads.push(kind);
        return ids.map(id => (this.views_.get(`${kind}:${String(id)}`) ?? null) as core.ViewOf<K> | null);
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
    it('projects the kinds of a flush in the order of their dependencies, not in the order of the changes', () => {
        const source = new FakeSource();
        const store = new RuntimeStore(new HandleTable(), MANUAL);
        // The derived view of a workbook reads the workbook of the same flush
        const seen: (string | null)[] = [];
        const derived: ViewProjection<'workbookDerived', unknown> = {
            project: (id, _prev, view) => {
                seen.push((store.get('workbook', id) as { name: string } | null)?.name ?? null);
                return view;
            },
        };
        store.attach(source, { workbookDerived: derived } as never);
        source.set('workbook', 'w1', 1, { name: 'first' });
        store.flush();
        // The derived view comes first in the changes, the workbook is renamed in the same flush
        source.set('workbookDerived', 'w1', 2, { scriptKeys: [] });
        source.set('workbook', 'w1', 3, { name: 'second' });
        store.flush();
        expect(source.reads).toEqual(['workbook', 'workbook', 'workbookDerived']);
        expect(seen).toEqual(['second']);
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

        // A slice that keeps failing is asked for a few times, then the store waits for its next change
        fail = true;
        for (let revision = 3; revision < 10; ++revision) {
            source.set('connection', 'b', revision, { name: `b${revision}` });
            store.flush();
        }
        expect(source.resynced.filter(slice => slice === 'connection:b')).toHaveLength(3);
        expect(store.get('connection', 'b')).toEqual({ name: 'b1' });
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

    it('keeps the view of a slice that reads as null while it is busy, and releases a slice that went', () => {
        const source = new FakeSource();
        const store = new RuntimeStore(new HandleTable(), MANUAL);
        store.attach(source);
        source.set('workbook', 'w', 1, { name: 'w1' });
        store.flush();
        // Busy: the slice moved but its view reads as null, the runtime reports it again
        source.views_.delete('workbook:w');
        source.changes.push({ kind: 'workbook', id: 'w', revision: 2 });
        store.flush();
        expect(store.get('workbook', 'w')).toEqual({ name: 'w1' });
        // Gone: the change says so
        source.changes.push({ kind: 'workbook', id: 'w', revision: null });
        store.flush();
        expect(store.get('workbook', 'w')).toBeNull();
    });
});
