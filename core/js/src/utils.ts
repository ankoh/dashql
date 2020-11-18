// Copyright (c) 2020 The DashQL Authors

/// A special-purpose stack for the DFS.
/// The stack is backed by a native array and does not shrink.
export class NativeStack {
    /// The buffer
    _buffer: Uint32Array;
    /// The size
    _size: number;

    public constructor(capacity: number) {
        this._buffer = new Uint32Array(capacity);
        this._size = 0;
    }

    /// Resize the buffer
    protected resize(newSize: number) {
        let b = new Uint32Array(new ArrayBuffer(newSize * 4))
        b.set(this._buffer);
        this._buffer = b;
    }

    /// Is empty?
    public empty(): boolean { return this._size <= 0; }
    /// Return the top element
    public top(): number { return this._buffer[this._size - 1]; }
    /// Pop an element
    public pop(): number { return this._buffer[--this._size]; }
    /// Push a new element
    public push(v: number) {
        if (this._size == this._buffer.length) {
            this.resize(this._buffer.length * 1.5);
        }
        this._buffer[this._size++] = v;
    }
}

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
}
