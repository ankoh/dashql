// Copyright (c) 2021 The DashQL Authors

import { NativeMinHeap } from '.';

/// A LRU cache entry
export interface LRUCacheEntry {
    key: string;
}

/// Caches the last N requests.
/// Evicts cached requests with LRU queue.
export abstract class LRUCache<Value extends LRUCacheEntry> {
    /// The slots
    _slots: (Value | null)[];
    /// The slot mapping
    _slotMapping: Map<string, number>;
    /// The LRU queue
    _lruQueue: NativeMinHeap;
    /// The clock
    _clock: number;

    constructor(size: number) {
        this._slots = [];
        this._slots.length += size;
        this._slots.fill(null, 0, size);
        this._slotMapping = new Map();
        this._lruQueue = new NativeMinHeap();
        this._lruQueue.buildDefault(size);
        this._clock = 0;
    }

    /// Insert handler
    protected abstract onInsert(slot: number, newEntry: Value, evictedEntry: Value | null): void;
    /// Hit handler
    protected abstract onHit(slot: number, newEntry: Value): void;

    /// Use a slot?
    protected use(slot: number): void {
        this._lruQueue.setRank(slot, ++this._clock);
    }

    /// Find an entry
    public find(k: string): Value | null {
        const i = this._slotMapping.get(k);
        if (i === undefined) {
            return null;
        }
        this.use(i);
        this.onHit(i, this._slots[i]!);
        return this._slots[i];
    }

    /// Insert an entry
    public insert(v: Value): Value {
        const i = this._lruQueue.top();
        const e = this._slots[i];
        if (e) {
            this._slotMapping.delete(e.key);
        }
        this._slots[i] = v;
        this._slotMapping.set(v.key, i);
        this.use(i);
        this.onInsert(i, v, e);
        return v;
    }
}
