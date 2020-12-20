import { NativeBitmap, NativeMinHeap } from "../utils";

/// Caches the last N requests.
/// Evicts cached requests with LRU queue.
export abstract class LRUCache<Value> {
    /// The slots
    _slots: ([string, Value] | null)[];
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
    protected abstract onEvict(slot: number, newEntry: [string, Value], evictedEntry: [string, Value] | null): void;
    /// Use a slot?
    protected use(slot: number) {
        this._lru_queue.setRank(slot, new Date().getTime());
    }

    /// Find an entry
    public find(k: string): Value | null {
        for (let i = 0; i < this._slots.length; ++i) {
            const entry = this._slots[i];
            if (!entry) continue;
            if (entry[0] == k) {
                this.use(i);
                return entry[1];
            }
        }
        return null;
    }

    /// Insert an entry
    public insert(k: string, v: Value): Value {
        const i = this._lru_queue.top();
        if (this._slot_mask.isSet(i)) {
            const prev = this._slots[i]!;
            const next: [string, Value] = [k, v];
            this.onEvict(i, prev, next);
            this._slots[i] = next;
            this.use(i);
        }
        return v;
    }
}
