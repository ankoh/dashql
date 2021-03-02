// Copyright (c) 2020 The DashQL Authors

import { webdb as proto } from '@dashql/proto';
import { SQLType, Value } from './value';
import { BlockingChunkIterator, VectorBuffers } from './iterator_base';

interface ColumnProxy {
    /// Cast value at index as float
    castAsDouble(chunk: number, row: number): number | null;
    /// Cast value at index as integer
    castAsInteger(chunk: number, row: number): number | null;
    /// Cast value at index as string
    castAsString(chunk: number, row: number): string | null;
}

class StringColumnProxy implements ColumnProxy {
    /// The value arrays
    _values: proto.VectorString[];
    /// Constructor
    constructor(values: proto.VectorString[]) {
        this._values = values;
    }
    /// Cast value at index as float
    public castAsDouble(chunk: number, row: number): number | null {
        return parseFloat(this._values[chunk].values(row));
    }
    /// Cast value at index as integer
    public castAsInteger(chunk: number, row: number): number | null {
        return parseInt(this._values[chunk].values(row));
    }
    /// Cast value at index as string
    public castAsString(chunk: number, row: number): string | null {
        return this._values[chunk].values(row);
    }
}

class NullableStringColumnProxy implements ColumnProxy {
    /// The value arrays
    _values: proto.VectorString[];
    /// The nullmask arrays
    _nullmasks: Int8Array[];
    /// Constructor
    constructor(values: proto.VectorString[], nullmasks: Int8Array[]) {
        this._values = values;
        this._nullmasks = nullmasks;
    }
    /// Cast value at index as float
    public castAsDouble(chunk: number, row: number): number | null {
        return this._nullmasks[chunk][row] ? null : parseFloat(this._values[chunk].values(row));
    }
    /// Cast value at index as integer
    public castAsInteger(chunk: number, row: number): number | null {
        return this._nullmasks[chunk][row] ? null : parseInt(this._values[chunk].values(row));
    }
    /// Cast value at index as string
    public castAsString(chunk: number, row: number): string | null {
        return this._nullmasks[chunk][row] ? null : this._values[chunk].values(row);
    }
}

class Float64ColumnProxy implements ColumnProxy {
    /// The value arrays
    _values: Float64Array[];
    /// Constructor
    constructor(values: Float64Array[]) {
        this._values = values;
    }
    /// Cast value at index as float
    public castAsDouble(chunk: number, row: number): number | null {
        return this._values[chunk][row];
    }
    /// Cast value at index as integer
    public castAsInteger(chunk: number, row: number): number | null {
        return Math.trunc(this._values[chunk][row]);
    }
    /// Cast value at index as string
    public castAsString(chunk: number, row: number): string | null {
        return this._values[chunk][row].toString();
    }
}

class NullableFloat64ColumnProxy implements ColumnProxy {
    /// The value arrays
    _values: Float64Array[];
    /// The nullmask arrays
    _nullmasks: Int8Array[];
    /// Constructor
    constructor(values: Float64Array[], nullmasks: Int8Array[]) {
        this._values = values;
        this._nullmasks = nullmasks;
    }
    /// Cast value at index as float
    public castAsDouble(chunk: number, row: number): number | null {
        return this._nullmasks[chunk][row] ? null : this._values[chunk][row];
    }
    /// Cast value at index as integer
    public castAsInteger(chunk: number, row: number): number | null {
        return this._nullmasks[chunk][row] ? null : Math.trunc(this._values[chunk][row]);
    }
    /// Cast value at index as string
    public castAsString(chunk: number, row: number): string | null {
        return this._nullmasks[chunk][row] ? null : this._values[chunk][row].toString();
    }
}

type IntegerAttributeProxy = (chunkId: number, rowId: number) => number | null;
type FloatAttributeProxy = (chunkId: number, rowId: number) => number | null;
type StringAttributeProxy = (chunkId: number, rowId: number) => string | null;
type AttributeProxy = IntegerAttributeProxy | FloatAttributeProxy | StringAttributeProxy;

/// The row proxy constructor
type RowProxyCtor = (chunk: number, row: number) => any;

/// Define a row proxy type
function defineRowProxyType(columnNames: string[], columnProxies: AttributeProxy[]): RowProxyCtor {
    const ctor = function (this: any, chunk: number, row: number) {
        this.__chunk__ = chunk;
        this.__row__ = row;
    };
    Object.defineProperty(ctor.prototype, '__chunk__', {
        value: -1,
        enumerable: false,
        writable: false,
    });
    Object.defineProperty(ctor.prototype, '__row__', {
        value: -1,
        enumerable: false,
        writable: false,
    });
    for (let i = 0; i < columnProxies.length; ++i) {
        const proxy = columnProxies[i];
        Object.defineProperty(ctor.prototype, columnNames[i], {
            get: function () {
                return proxy(this.__chunk__, this.__row__);
            },
            enumerable: true,
        });
    }
    return (chunk: number, row: number) => new (ctor as any)(chunk, row);
}

/// Read a double column accross multiple chunks
export function readFloat64Column(
    chunks: proto.QueryResultChunk[],
    columnId: number,
): [Float64Array[] | null, Int8Array[] | null] {
    let values: Float64Array[] = [];
    let nulls: Int8Array[] = [];
    let hasNulls = true;
    const tmp = new proto.VectorF64();
    for (const chunk of chunks) {
        const c = chunk.columns(columnId);
        if (!c || c.variantType() != proto.VectorVariant.VectorF64) {
            return [null, null];
        }
        const v = c.variant(tmp)!;
        values.push(v.valuesArray()!);
        const n = v.nullMaskArray();
        hasNulls = hasNulls && n != null;
        if (hasNulls) nulls.push(n!);
    }
    return [values, hasNulls ? nulls : null];
}

/// Read a string column accross multiple chunks
export function readStringColumn(
    chunks: proto.QueryResultChunk[],
    column_id: number,
): [proto.VectorString[] | null, Int8Array[] | null] {
    let values: proto.VectorString[] = [];
    let nulls: Int8Array[] = [];
    let hasNulls = true;
    for (const chunk of chunks) {
        const c = chunk.columns(column_id);
        if (!c || c.variantType() != proto.VectorVariant.VectorString) {
            return [null, null];
        }
        const vec = c.variant(new proto.VectorString())!;
        values.push(vec);
        const n = vec.nullMaskArray();
        hasNulls = hasNulls && n != null;
        if (hasNulls) nulls.push(n!);
    }
    return [values, hasNulls ? nulls : null];
}

export function proxyMaterializedChunkRows<T>(iter: BlockingChunkIterator): T[] {
    // Collect all chunks
    let chunks: proto.QueryResultChunk[] = [];
    while (iter.nextBlocking()) {
        chunks.push(iter.currentChunk);
    }

    // Build all column proxies
    let columnProxies: AttributeProxy[] = [];
    let columnNames: string[] = [];
    for (let columnId = 0; columnId < iter.columnCount; ++columnId) {
        switch (iter.columnTypes[columnId].typeId()) {
            case proto.SQLTypeID.BOOLEAN:
                break;

            case proto.SQLTypeID.TINYINT:
            case proto.SQLTypeID.SMALLINT:
            case proto.SQLTypeID.INTEGER: {
                const [values, nulls] = readFloat64Column(chunks, columnId);
                if (!values) continue;
                const proxy = !nulls
                    ? new Float64ColumnProxy(values!)
                    : new NullableFloat64ColumnProxy(values!, nulls!);
                columnProxies.push(proxy.castAsInteger.bind(proxy));
                columnNames.push(iter.result.columnNames(columnId));
                break;
            }

            case proto.SQLTypeID.FLOAT:
            case proto.SQLTypeID.DOUBLE: {
                const [values, nulls] = readFloat64Column(chunks, columnId);
                if (!values) continue;
                const proxy = !nulls
                    ? new Float64ColumnProxy(values!)
                    : new NullableFloat64ColumnProxy(values!, nulls!);
                columnProxies.push(proxy.castAsDouble.bind(proxy));
                columnNames.push(iter.result.columnNames(columnId));
                break;
            }

            case proto.SQLTypeID.CHAR:
            case proto.SQLTypeID.VARCHAR: {
                const [values, nulls] = readStringColumn(chunks, columnId);
                if (!values) continue;
                const proxy = !nulls
                    ? new StringColumnProxy(values!)
                    : new NullableStringColumnProxy(values!, nulls!);
                columnProxies.push(proxy.castAsDouble.bind(proxy));
                columnNames.push(iter.result.columnNames(columnId));
                break;
            }

            case proto.SQLTypeID.DATE:
            case proto.SQLTypeID.TIME:
            case proto.SQLTypeID.TIMESTAMP:
                break;

            case proto.SQLTypeID.BIGINT:
            case proto.SQLTypeID.DECIMAL:
            case proto.SQLTypeID.VARBINARY:
            case proto.SQLTypeID.BLOB:
            case proto.SQLTypeID.INTERVAL:
            case proto.SQLTypeID.INVALID:
            case proto.SQLTypeID.SQLNULL:
            case proto.SQLTypeID.UNKNOWN:
            case proto.SQLTypeID.ANY:
            case proto.SQLTypeID.HUGEINT:
            case proto.SQLTypeID.POINTER:
            case proto.SQLTypeID.HASH:
            case proto.SQLTypeID.STRUCT:
            case proto.SQLTypeID.LIST:
                break;
        }
    }

    const rowProxyCtor = defineRowProxyType(columnNames, columnProxies);
    let rows: T[] = [];
    for (let chunkId = 0; chunkId < chunks.length; ++chunkId) {
        for (let rowId = 0; rowId < chunks[chunkId].rowCount(); ++rowId) {
            rows.push(rowProxyCtor(chunkId, rowId) as T);
        }
    }
    return rows;
}
