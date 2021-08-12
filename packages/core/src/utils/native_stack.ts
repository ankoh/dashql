// Copyright (c) 2020 The DashQL Authors

/// A special-purpose stack for the DFS.
/// The stack is backed by a native array and does not shrink.
export class NativeStack {
    /// The buffer
    _buffer: Uint32Array;
    /// The size
    _size: number;

    public constructor(capacity = 8) {
        this._buffer = new Uint32Array(capacity);
        this._size = 0;
    }

    /// Resize the buffer
    protected resize(newSize: number): void {
        const b = new Uint32Array(newSize);
        b.set(this._buffer);
        this._buffer = b;
    }

    /// Clear the stack
    public clear(): void {
        this._size = 0;
    }
    /// Is empty?
    public empty(): boolean {
        return this._size <= 0;
    }
    /// Return the top element
    public top(): number {
        return this._buffer[this._size - 1];
    }
    /// Pop an element
    public pop(): number {
        return this._buffer[--this._size];
    }
    /// Push a new element
    public push(v: number): void {
        if (this._size >= this._buffer.length) {
            this.resize(this._buffer.length * 1.5);
        }
        this._buffer[this._size++] = v;
    }
}
