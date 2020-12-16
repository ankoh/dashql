// Copyright (c) 2020 The DashQL Authors

/// A compact bitmap for the post-order DFS
export class NativeBitmap {
    /// The buffer
    _buffer: Uint32Array;

    public constructor(size: number) {
        this._buffer = new Uint32Array(size >> 5);
    }

    /// Is empty?
    public isEmpty(): boolean {
        let r = 0;
        for (let i = 0; i < this._buffer.length; ++i) {
            r |= this._buffer[i];
        }
        return r != 0;
    }

    /// Set a bit
    public set(index: number) {
        const byte_idx = index >> 5;
        const bit_idx = index & 31;
        this._buffer[byte_idx] |= 1 << bit_idx;
    }

    /// Is a bit set?
    public isSet(index: number) {
        const byte_idx = index >> 5;
        const bit_idx = index & 31;
        return (this._buffer[byte_idx] & (1 << bit_idx)) != 0;
    }

    /// Clear a bit
    public clear(index: number) {
        const byte_idx = index >> 5;
        const bit_idx = index & 31;
        this._buffer[byte_idx] &= ~(1 << bit_idx);
    }
}
