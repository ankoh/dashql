// Copyright (c) 2020 The DashQL Authors

export type NativeMinHeapKey = number;
export type NativeMinHeapRank = number;

/// A native heap
export class NativeMinHeap {
    /// The entries
    _entries: Uint32Array;
    /// The index
    _index: Uint32Array;
    /// The size
    _size: number;

    /// Constructor
    public constructor(entries: [NativeMinHeapKey, NativeMinHeapRank][] = []) {
        this._entries = new Uint32Array(0);
        this._index = new Uint32Array(0);
        this._size = 0;
        this.reset(entries);
    }

    /// Reset the heap
    public reset(entries: [NativeMinHeapKey, NativeMinHeapRank][] = []) {
        if (this._entries.length < entries.length) {
            this._entries = new Uint32Array(2 * entries.length);
            this._index = new Uint32Array(entries.length);
        }
        this._size = entries.length;
        for (let i = 0; i < entries.length; ++i) {
            this._entries[2 * i] = entries[i][0];
            this._entries[2 * i + 1] = entries[i][1];
            this._index[entries[i][0]] = i;
        }
    }

    /// Access element
    protected value(index: number): NativeMinHeapKey {
        return this._entries[2 * index];
    }
    /// Access rank
    protected rank(index: number): NativeMinHeapRank {
        return this._entries[2 * index + 1];
    }
    /// Swap two positions
    protected swapAt(i: number, j: number) {
        this._index[this.value(i)] = j;
        this._index[this.value(j)] = i;
        const v = this.value(i);
        const r = this.rank(i);
        this._entries[2 * i] = this._entries[2 * j];
        this._entries[2 * i + 1] = this._entries[2 * j + 1];
        this._entries[2 * j] = v;
        this._entries[2 * j + 1] = r;
    }
    /// Sift an element up
    protected siftUp(i: number) {
        for (let p = Math.floor((i - 1) / 2); i > 0 && this.rank(p) > this.rank(i);) {
            console.log(p);
            this.swapAt(i, p);
            i = p;
            p = Math.floor((i - 1) / 2);
        }
    }
    /// Sift an element down
    protected siftDown(i: number) {
        while (true) {
            const l = 2 * i + 1;
            const r = 2 * i + 2;
            const prev = i;
            if (l < this._size && this.rank(l) < this.rank(i)) {
                this.swapAt(l, i);
                i = l;
            }
            if (r < this._size && this.rank(r) < this.rank(i)) {
                this.swapAt(r, i);
                i = r;
            }
            if (prev == i) {
                break;
            }
        }
    }
    /// Is empty?
    public empty(): boolean { return this._size <= 0; }
    /// Get the min element
    public top(): number { return this._entries[0]; }
    /// Get the min element rank
    public topRank(): number { return this._entries[1]; }
    /// Pop the back of the vector
    protected popBack() { --this._size; }
    /// Pop the min element
    public pop() {
        this.swapAt(0, this._size - 1);
        this.popBack();
        this.siftDown(0);
    }
    /// Decrement a key
    public decrementKey(key: NativeMinHeapKey, by: number) {
        const i = this._index[key];
        this._entries[2 * i + 1] -= Math.min(this._entries[2 * i + 1], by);
        this.siftUp(i);
    }
    /// Get the current rank of a key
    public findRank(key: NativeMinHeapKey) {
        return this.rank(this._index[key]);
    }
}
