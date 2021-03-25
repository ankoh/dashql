/** A column iterator */
export class ColumnIterator<T> implements Iterable<T> {
    protected idx: number;
    protected end: number;
    protected getter: (idx: number) => T;

    constructor(start: number, end: number, getter: (idx: number) => T) {
        this.idx = start;
        this.end = end;
        this.getter = getter;
    }

    next(): IteratorResult<T> {
        if (this.idx >= this.end) {
            return { done: true, value: null };
        }
        return {
            done: false,
            value: this.getter(this.idx++),
        };
    }

    [Symbol.iterator]() {
        return this;
    }
}
