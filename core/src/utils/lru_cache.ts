import { NativeBitmap, NativeMinHeap } from "../utils";

/// Caches the last N requests.
/// Evicts cached requests with LRU queue.
export abstract class LRUCache<Key, Value> {
    /// The slots
    _slots: ([Key, Value] | null)[];
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

    /// Compare two keys
    protected abstract compare(l: Key, r: Key): number;
    /// Evict an entry
    protected abstract evict(k: Key, v: Value): void;
    /// Use a slot?
    protected useSlot(slot: number) {
        this._lru_queue.setRank(slot, new Date().getTime());
    }

    /// Find an entry
    public find(k: Key): Value | null {
        for (let i = 0; i < this._slots.length; ++i) {
            const entry = this._slots[i];
            if (!entry) continue;
            if (this.compare(entry[0], k) == 0) {
                this.useSlot(i);
                return entry[1];
            }
        }
        return null;
    }

    /// Insert an entry
    public insert(k: Key, v: Value) {
        const i = this._lru_queue.top();
        if (this._slot_mask.isSet(i)) {
            const entry = this._slots[i]!;
            this.evict(entry[0], entry[1]);
            this._slots[i] = [k, v];
            this.useSlot(i);
        }
    }
}
