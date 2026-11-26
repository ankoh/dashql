import * as arrow from 'apache-arrow';

// Arrow vectors assembled from their buffers.
// The Arrow builders (vectorFromArray, tableFromArrays of plain arrays, makeBuilder) compile their null check with
// `new Function`, which the Content-Security-Policy of the app forbids.

/// The validity bitmap of values, null and undefined are null
function validity(values: ReadonlyArray<unknown>): { nullCount: number; nullBitmap: Uint8Array | undefined } {
    const nullBitmap = new Uint8Array((values.length + 7) >> 3);
    let nullCount = 0;
    values.forEach((value, i) => {
        if (value == null) {
            ++nullCount;
        } else {
            nullBitmap[i >> 3] |= 1 << (i & 7);
        }
    });
    return { nullCount, nullBitmap: nullCount > 0 ? nullBitmap : undefined };
}

/// The 32-bit value offsets and the concatenated bytes of variable-width values
function variableWidthBuffers(values: ReadonlyArray<Uint8Array | null | undefined>): { valueOffsets: Int32Array; data: Uint8Array } {
    const valueOffsets = new Int32Array(values.length + 1);
    let end = 0;
    values.forEach((bytes, i) => {
        end += bytes?.length ?? 0;
        if (end > 0x7fffffff) {
            throw new RangeError(`${end} bytes exceed the 32-bit offsets of an Arrow vector`);
        }
        valueOffsets[i + 1] = end;
    });
    const data = new Uint8Array(end);
    values.forEach((bytes, i) => bytes && data.set(bytes, valueOffsets[i]));
    return { valueOffsets, data };
}

/// A Utf8 vector of strings
export function utf8Vector(values: ReadonlyArray<string | null | undefined>): arrow.Vector<arrow.Utf8> {
    const encoder = new TextEncoder();
    const buffers = variableWidthBuffers(values.map(value => value == null ? null : encoder.encode(value)));
    return arrow.makeVector(arrow.makeData({ type: new arrow.Utf8(), length: values.length, ...validity(values), ...buffers }));
}

/// A Binary vector of byte arrays
export function binaryVector(values: ReadonlyArray<Uint8Array | null | undefined>): arrow.Vector<arrow.Binary> {
    const buffers = variableWidthBuffers(values);
    return arrow.makeVector(arrow.makeData({ type: new arrow.Binary(), length: values.length, ...validity(values), ...buffers }));
}

/// A vector of numbers in a single or double precision float type
export function floatVector<T extends arrow.Float32 | arrow.Float64>(type: T, values: ReadonlyArray<number | null | undefined>): arrow.Vector<T> {
    const data = new type.ArrayType(values.length);
    values.forEach((value, i) => (data[i] = value ?? 0));
    return arrow.makeVector(arrow.makeData({ type, length: values.length, ...validity(values), data }));
}

/// A vector of integers, 64-bit types take bigints
export function intVector<T extends arrow.Int>(type: T, values: ReadonlyArray<number | bigint | null | undefined>): arrow.Vector<T> {
    const data = new type.ArrayType(values.length);
    const zero = type.bitWidth === 64 ? 0n : 0;
    values.forEach((value, i) => ((data as unknown as Array<number | bigint>)[i] = value ?? zero));
    return arrow.makeVector(arrow.makeData({ type, length: values.length, ...validity(values), data }));
}

/// A Bool vector of booleans
export function boolVector(values: ReadonlyArray<boolean | null | undefined>): arrow.Vector<arrow.Bool> {
    const data = new Uint8Array((values.length + 7) >> 3);
    values.forEach((value, i) => {
        if (value) data[i >> 3] |= 1 << (i & 7);
    });
    return arrow.makeVector(arrow.makeData({ type: new arrow.Bool(), length: values.length, ...validity(values), data }));
}

/// A table with its rows numbered from 1 in an appended column of 64-bit integers that can't be null, e.g. a result
/// that the compute database imports or a stored result with the order of its rows. Hyper numbers rows in no
/// particular order (`row_number() OVER ()`), the numbers are therefore given while the table still holds the rows in
/// order. The batches keep their columns, the row numbers are a new column of each. With `names` the fields take these
/// names, in order, e.g. the unique names of the compute database for a result that names two fields alike.
export function appendRowNumbers(table: arrow.Table, name: string, names?: readonly string[]): arrow.Table {
    if (names != null && names.length !== table.schema.fields.length) {
        throw new Error(`${names.length} names for the ${table.schema.fields.length} fields of a table`);
    }
    const named = names == null ? table.schema.fields : table.schema.fields.map((field, i) => field.clone({ name: names[i] }));
    const fields = [...named, new arrow.Field(name, new arrow.Int64(), false)];
    const schema = new arrow.Schema(fields, table.schema.metadata);
    let next = 1n;
    const batches = table.batches.map(batch => {
        const rows = batch.numRows;
        const numbers = new BigInt64Array(rows);
        for (let i = 0; i < rows; ++i) numbers[i] = next++;
        const rowNumbers = arrow.makeData({ type: new arrow.Int64(), length: rows, nullCount: 0, data: numbers });
        const children = [...batch.data.children, rowNumbers] as arrow.Data[];
        const data = arrow.makeData({ type: new arrow.Struct(fields), length: rows, nullCount: 0, children });
        return new arrow.RecordBatch(schema, data);
    });
    return new arrow.Table(schema, batches);
}
