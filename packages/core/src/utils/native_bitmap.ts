// Copyright (c) 2020 The DashQL Authors

/// A compact bitmap for the post-order DFS
export class NativeBitmap {
    /// The buffer
    _buffer: Uint32Array;
    /// The size of the buffer
    _size: number;

    public constructor(size: number = 0) {
        this._buffer = new Uint32Array((size >> 5) + 1);
        this._size = size;
    }

    /// Reset the bitmap to a new size
    public reset(newSize: number) {
        const n = newSize >> 5;
        if (n > this._buffer.length) {
            this._buffer = new Uint32Array(n);
        } else {
            for (let i = 0; i < this._buffer.length; ++i) {
                this._buffer[i] = 0;
            }
        }
        this._size = newSize;
    }

    /// Are no bits set?
    public empty(): boolean {
        let r = 0;
        for (let i = 0; i < this._buffer.length; ++i) {
            r |= this._buffer[i];
        }
        return r == 0;
    }

    /// Are all bits set?
    public allSet(): boolean {
        if (this._buffer.length == 0) return true;
        let r = 0xFFFFFFFF;
        for (let i = 0; (i + 1) < this._buffer.length; ++i) {
            r &= this._buffer[i];
        }
        let all_set = r == 0xFFFFFFFF;
        const last_idx = this._buffer.length - 1;
        const last = this._buffer[last_idx];
        const bits_in_last = this._size - (last_idx << 5);
        for (let i = 0, mask = 1; i < bits_in_last; i += 1, mask <<= 1) {
            all_set &&= (last & mask) != 0;
        }
        return all_set;
    }

    /// Set a bit
    public set(index: number): NativeBitmap {
        const entry_idx = index >> 5;
        const bit_idx = index & 31;
        this._buffer[entry_idx] |= 1 << bit_idx;
        return this;
    }
    /// Is a bit set?
    public isSet(index: number) {
        const entry_idx = index >> 5;
        const bit_idx = index & 31;
        return (this._buffer[entry_idx] & (1 << bit_idx)) != 0;
    }


    /// Clear a bit
    public clear(index: number): NativeBitmap {
        const entry_idx = index >> 5;
        const bit_idx = index & 31;
        this._buffer[entry_idx] &= ~(1 << bit_idx);
        return this;
    }

    /// Flip a bit
    public flip(index: number): NativeBitmap {
        if (this.isSet(index)) {
            this.clear(index);
        } else {
            this.set(index);
        }
        return this;
    }

    /// Clear all bits
    public clearAll(): NativeBitmap {
        for (let i = 0; this._buffer.length; ++i) {
            this._buffer[i] = 0;
        }
        return this;
    }

    /// Contains other bitmap that is equal in size?
    public containsUnsafe(other: NativeBitmap) {
        console.assert(this._size == other._size);
        let contains = true;
        for (let i = 0; i < this._buffer.length; ++i) {
            contains &&= (other._buffer[i] & this._buffer[i]) == other._buffer[i];
        }
        return contains;
    }

    /// Get the entries (slow, only for debugging)
    public entries() {
        let buffer = [];
        for (let i = 0; i < this._size; ++i) {
            if (this.isSet(i)) {
                buffer.push(i);
            }
        }
        return buffer;
    }
}
