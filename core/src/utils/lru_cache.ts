import { NativeBitmap, NativeMinHeap } from "../utils";

/// A LRU cache entry
export interface LRUCacheEntry {
    key: string;
}

/// Caches the last N requests.
/// Evicts cached requests with LRU queue.
export abstract class LRUCache<Value extends LRUCacheEntry> {
    /// The slots
    _slots: (Value | null)[];
    /// The slot mask
    _slot_mask: NativeBitmap;
    /// The LRU queue
    _lru_queue: NativeMinHeap;

    constructor(size: number) {
        this._slots = [];
        this._slots.length += size;
        this._slots.fill(null, 0, size);
        this._slot_mask = new NativeBitmap(size);
        this._lru_queue = new NativeMinHeap();
        this._lru_queue.buildDefault(size);
    }

    /// Update handler
    protected abstract onEvict(slot: number, newEntry: Value, evictedEntry: Value | null): void;
    /// Use a slot?
    protected use(slot: number) {
        this._lru_queue.setRank(slot, new Date().getTime());
    }

    /// Find an entry
    public find(k: string): Value | null {
        for (let i = 0; i < this._slots.length; ++i) {
            const entry = this._slots[i];
            if (!entry) continue;
            if (entry.key == k) {
                this.use(i);
                return entry;
            }
        }
        return null;
    }

    /// Insert an entry
    public insert(v: Value): Value {
        const i = this._lru_queue.top();
        if (this._slot_mask.isSet(i)) {
            const prev = this._slots[i]!;
            this.onEvict(i, v, prev);
            this._slots[i] = v;
            this.use(i);
        }
        return v;
    }
}
