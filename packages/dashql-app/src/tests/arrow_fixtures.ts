import * as arrow from 'apache-arrow';

// vectorFromArray and tableFromArrays of Arrow for test fixtures, without evaluating code.
// The Arrow versions compile the null check of their builders with `new Function`, which the Content-Security-Policy
// of the test frame forbids, like the one of the app. A builder without null values compiles nothing, so these build
// without them and give every builder the null check of the Arrow versions, `value !== null`, as a plain function.
// App code assembles its vectors with utils/arrow_vectors.ts instead, this relies on internals of the builders.

interface NullCheckedBuilder {
    _isValid: (value: unknown) => boolean;
}

function checkNulls(builder: arrow.Builder): arrow.Builder {
    (builder as unknown as NullCheckedBuilder)._isValid = value => value !== null;
    builder.children.forEach(checkNulls);
    if (builder instanceof arrow.DictionaryBuilder) checkNulls(builder.indices);
    return builder;
}

function isDate(value: unknown): boolean {
    return Object.prototype.toString.call(value) === '[object Date]';
}

/// The type that vectorFromArray of Arrow infers for values
function inferType(values: ReadonlyArray<unknown>): arrow.DataType {
    if (values.length === 0) return new arrow.Null();
    const present = values.filter(value => value != null);
    if (present.every(value => typeof value === 'number')) return new arrow.Float64();
    if (present.every(value => typeof value === 'string')) return new arrow.Dictionary(new arrow.Utf8(), new arrow.Int32());
    if (present.every(value => typeof value === 'bigint')) return new arrow.Int64();
    if (present.every(value => typeof value === 'boolean')) return new arrow.Bool();
    if (present.every(isDate)) return new arrow.TimestampMillisecond();
    if (present.every(value => Array.isArray(value))) {
        const child = inferType(present[0] as unknown[]);
        if (present.every(value => arrow.util.compareTypes(child, inferType(value as unknown[])))) {
            return new arrow.List(new arrow.Field('', child, true));
        }
    } else if (present.every(value => typeof value === 'object' && !Array.isArray(value) && !isDate(value))) {
        const fields = new Map<string, arrow.Field>();
        for (const row of present as Array<Record<string, unknown>>) {
            for (const [key, value] of Object.entries(row)) {
                if (!fields.has(key) && value != null) fields.set(key, new arrow.Field(key, inferType([value]), true));
            }
        }
        return new arrow.Struct([...fields.values()]);
    }
    throw new TypeError('Unable to infer Vector type from input values, explicit type declaration expected.');
}

/// vectorFromArray of Arrow, without evaluating code
export const vectorFromArray = ((init: unknown, type?: arrow.DataType): arrow.Vector => {
    if (init instanceof arrow.Data || init instanceof arrow.Vector || ArrayBuffer.isView(init) || (init as { type?: unknown }).type instanceof arrow.DataType) {
        return arrow.makeVector(init as arrow.Data);
    }
    const values = [...(init as Iterable<unknown>)];
    const builder = checkNulls(arrow.makeBuilder({ type: type ?? inferType(values) }));
    for (const value of values) builder.append(value);
    const vector = builder.finish().toVector();
    return arrow.DataType.isDictionary(vector.type) ? vector.memoize() : vector;
}) as typeof arrow.vectorFromArray;

/// tableFromArrays of Arrow, without evaluating code
export const tableFromArrays = ((input: Record<string, unknown>): arrow.Table => {
    const vectors = Object.fromEntries(Object.entries(input).map(([name, column]) => [name, vectorFromArray(column as never)]));
    return new arrow.Table(vectors);
}) as typeof arrow.tableFromArrays;
