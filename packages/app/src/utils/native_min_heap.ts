// Copyright (c) 2021 The DashQL Authors

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
        this.build(entries);
    }

    /// Build the heap with entries
    public build(entries: [NativeMinHeapKey, NativeMinHeapRank][] = []): void {
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

    /// Build the default heap
    public buildDefault(size: number): void {
        this._entries = new Uint32Array(2 * size);
        this._index = new Uint32Array(size);
        this._size = size;
        for (let i = 0; i < size; ++i) {
            this._entries[2 * i] = i;
            this._entries[2 * i + 1] = 0;
            this._index[i] = i;
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
    protected swapAt(i: number, j: number): void {
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
    protected siftUp(i: number): void {
        for (let p = Math.floor((i - 1) / 2); i > 0 && this.rank(p) >= this.rank(i); ) {
            this.swapAt(i, p);
            i = p;
            p = Math.floor((i - 1) / 2);
        }
    }
    /// Sift an element down
    protected siftDown(i: number): void {
        // eslint-disable-next-line no-constant-condition
        while (true) {
            const l = 2 * i + 1;
            const r = 2 * i + 2;
            const prev = i;
            if (l < this._size && this.rank(l) < this.rank(prev)) {
                this.swapAt(l, prev);
                i = l;
            }
            if (r < this._size && this.rank(r) < this.rank(prev)) {
                this.swapAt(r, prev);
                i = r;
            }
            if (prev == i) {
                break;
            }
        }
    }
    /// Is empty?
    public empty(): boolean {
        return this._size <= 0;
    }
    /// Get the min element
    public top(): number {
        return this._entries[0];
    }
    /// Get the min element rank
    public topRank(): number {
        return this._entries[1];
    }
    /// Pop the back of the vector
    protected popBack(): void {
        console.assert(this._size > 0);
        this._index[this.value(this._size - 1)] = -1;
        --this._size;
    }
    /// Pop the min element
    public pop(): void {
        this.swapAt(0, this._size - 1);
        this.popBack();
        this.siftDown(0);
    }
    /// Decrement a key
    public decrementRank(key: NativeMinHeapKey, by = 1): void {
        console.assert(this._index[key] != -1);
        const i = this._index[key];
        this._entries[2 * i + 1] -= Math.min(this._entries[2 * i + 1], by);
        this.siftUp(i);
    }
    /// Increment a key
    public incrementRank(key: NativeMinHeapKey, by = 1): void {
        console.assert(this._index[key] != -1);
        const i = this._index[key];
        this._entries[2 * i + 1] += Math.min(this._entries[2 * i + 1], by);
        this.siftDown(i);
    }
    /// Set a key
    public setRank(key: NativeMinHeapKey, rank: number): void {
        console.assert(this._index[key] != -1);
        const i = this._index[key];
        const prev = this._entries[2 * i + 1];
        this._entries[2 * i + 1] = rank;
        if (rank < prev) {
            this.siftUp(i);
        } else {
            this.siftDown(i);
        }
    }
    /// Get the current rank of a key
    public getRank(key: NativeMinHeapKey): number {
        return this.rank(this._index[key]);
    }

    public print(): string {
        let buffer = '';
        for (let i = 0; i < this._size; ++i) {
            buffer += ` [${this.value(i)}]=${this.rank(i)}`;
        }
        return buffer;
    }
}
