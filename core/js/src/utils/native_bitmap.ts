// Copyright (c) 2020 The DashQL Authors

/// A compact bitmap for the post-order DFS
export class NativeBitmap {
    /// The buffer
    _buffer: Uint32Array;

    public constructor(size: number) {
        this._buffer = new Uint32Array(size);
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
