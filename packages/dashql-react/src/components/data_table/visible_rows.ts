import * as arrow from 'apache-arrow';

/// Visit the values of an integer column as numbers, like `Number(column.get(i))` (nulls become 0).
/// Integer chunks are read from their value buffers directly. A chunk's values are already narrowed
/// to the chunk's window, so value `i` of the chunk is `values[i]`, exactly what `Vector.get` reads.
export function forEachIntegerValue(column: arrow.Vector, visit: (value: number, index: number) => void): void {
    if (column.type.typeId !== arrow.Type.Int) {
        for (let i = 0; i < column.length; ++i) {
            visit(Number(column.get(i)), i);
        }
        return;
    }
    let index = 0;
    for (const chunk of column.data) {
        const values = chunk.values as ArrayLike<number | bigint>;
        if (chunk.nullCount === 0) {
            for (let i = 0; i < chunk.length; ++i) {
                visit(Number(values[i]), index++);
            }
        } else {
            for (let i = 0; i < chunk.length; ++i) {
                visit(chunk.getValid(i) ? Number(values[i]) : 0, index++);
            }
        }
    }
}
