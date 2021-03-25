/** A column iterator */
export class ColumnIterator<T> implements Iterable<T> {
    idx: number;

    constructor(start: number, private end: number, private value: (idx: number) => T) {
        this.idx = start;
    }

    next(): IteratorResult<T> {
        if (this.idx >= this.end) {
            return { done: true, value: null };
        }
        return {
            done: false,
            value: this.value(this.idx++),
        };
    }

    [Symbol.iterator]() {
        return this;
    }
}
