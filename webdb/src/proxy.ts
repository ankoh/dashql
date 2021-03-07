// Copyright (c) 2020 The DashQL Authors

import { webdb as proto, webdb } from '@dashql/proto';
import { TmpBuffers } from './buffers';

type ValueArray = Uint8Array | Float64Array | proto.VectorI64 | proto.VectorI128 | proto.VectorString;

interface ChunkData {
    columns: (ValueArray | null)[];
    nullmasks: (Int8Array | null)[];
    partitionBoundaries: Uint8Array | null;
}

type BigIntAttributeProxy = (chunk: ChunkData, row: number) => bigint | null;
type BooleanAttributeProxy = (chunk: ChunkData, row: number) => boolean | null;
type IntegerAttributeProxy = (chunk: ChunkData, row: number) => number | null;
type FloatAttributeProxy = (chunk: ChunkData, row: number) => number | null;
type StringAttributeProxy = (chunk: ChunkData, row: number) => string | null;
type AttributeProxy =
    | BigIntAttributeProxy
    | BooleanAttributeProxy
    | IntegerAttributeProxy
    | FloatAttributeProxy
    | StringAttributeProxy;

function readColumn<T>(
    column: number,
    fn: (column: number, chunk: ChunkData, row: number) => T,
): (chunk: ChunkData, row: number) => T {
    return (chunk: ChunkData, row: number) => fn(column, chunk, row);
}

function checkNull<T>(
    fn: (column: number, chunk: ChunkData, row: number) => T,
): (column: number, chunk: ChunkData, row: number) => T | null {
    return (column: number, chunk: ChunkData, row: number) =>
        chunk.nullmasks[column] && chunk.nullmasks[column]![row] ? null : fn(column, chunk, row);
}

function readBigInt(column: number, chunk: ChunkData, row: number): bigint | null {
    return BigInt((chunk.columns[column] as proto.VectorI64).values(row)!.low);
}
function readHugeInt(column: number, chunk: ChunkData, row: number): bigint | null {
    const val = (chunk.columns[column] as proto.VectorI128).values(row)!;
    return (BigInt(val.upper().low) << BigInt(64)) | BigInt(val.lower().low);
}
function readBoolean(column: number, chunk: ChunkData, row: number): boolean | null {
    return (chunk.columns[column] as Uint8Array)[row] != 0;
}
function readDouble(column: number, chunk: ChunkData, row: number): number | null {
    return (chunk.columns[column] as Float64Array)[row];
}
function readDoubleAsInteger(column: number, chunk: ChunkData, row: number): number | null {
    return Math.trunc((chunk.columns[column] as Float64Array)[row]);
}
function readString(column: number, chunk: ChunkData, row: number): string | null {
    return (chunk.columns[column] as proto.VectorString).values(row);
}
function returnNull(chunk: ChunkData, row: number) {
    return null;
}

/// The row proxy constructor
type RowProxyCtor = (chunk: ChunkData, row: number) => any;

/// The base class for row proxies
export interface RowProxy {
    __chunkData__: ChunkData;
    __chunkRow__: number;
    __is_partition_boundary__: boolean;
    __attribute__: (i: number) => bigint | number | string | boolean | null;
}

/// Define a row proxy type
function defineRowProxyType(columnNames: string[], columnProxies: AttributeProxy[]): RowProxyCtor {
    const proxies = columnProxies;
    const ctor = function (this: any, data: ChunkData, chunkRow: number) {
        this.__chunkData__ = data;
        this.__chunkRow__ = chunkRow;
    };
    Object.defineProperty(ctor.prototype, '__chunkData__', {
        enumerable: false,
        writable: true,
    });
    Object.defineProperty(ctor.prototype, '__chunkRow__', {
        value: -1,
        enumerable: false,
        writable: true,
    });
    Object.defineProperty(ctor.prototype, '__is_partition_boundary__', {
        get: function () {
            const p = this.__chunkData__.partitionBoundaries;
            return p && p[this.__chunkRow__] != 0;
        },
        enumerable: false,
    });
    ctor.prototype.__attribute__ = function (i: number) {
        return proxies[i](this.__chunkData__, this.__chunkRow__);
    };
    for (let i = 0; i < columnProxies.length; ++i) {
        const proxy = columnProxies[i];
        Object.defineProperty(ctor.prototype, columnNames[i], {
            get: function () {
                return proxy(this.__chunkData__, this.__chunkRow__);
            },
            enumerable: true,
        });
    }
    return (chunk: ChunkData, row: number) => new (ctor as any)(chunk, row);
}

/// A row proxy type definition
export class RowProxyType {
    /// The query result
    _result: proto.QueryResult;
    /// The row constructor
    _ctor: RowProxyCtor;

    /// Constructor
    constructor(result: proto.QueryResult) {
        this._result = result;
        let columnNames: string[] = [];
        let columnProxies: AttributeProxy[] = [];
        for (let columnId = 0; columnId < result.columnTypesLength(); ++columnId) {
            columnNames.push(result.columnNames(columnId));
            switch (result.columnTypes(columnId)!.typeId()) {
                case proto.SQLTypeID.TINYINT:
                case proto.SQLTypeID.SMALLINT:
                case proto.SQLTypeID.INTEGER: {
                    columnProxies.push(readColumn(columnId, checkNull(readDoubleAsInteger)));
                    break;
                }

                case proto.SQLTypeID.FLOAT:
                case proto.SQLTypeID.DOUBLE: {
                    columnProxies.push(readColumn(columnId, checkNull(readDouble)));
                    break;
                }

                case proto.SQLTypeID.CHAR:
                case proto.SQLTypeID.VARCHAR: {
                    columnProxies.push(readColumn(columnId, checkNull(readString)));
                    break;
                }

                case proto.SQLTypeID.BOOLEAN: {
                    columnProxies.push(readColumn(columnId, checkNull(readBoolean)));
                    break;
                }

                case proto.SQLTypeID.BIGINT: {
                    columnProxies.push(readColumn(columnId, checkNull(readBigInt)));
                    break;
                }

                case proto.SQLTypeID.HUGEINT: {
                    columnProxies.push(readColumn(columnId, checkNull(readHugeInt)));
                    break;
                }

                case proto.SQLTypeID.DATE:
                case proto.SQLTypeID.TIME:
                case proto.SQLTypeID.TIMESTAMP:
                case proto.SQLTypeID.DECIMAL:
                case proto.SQLTypeID.VARBINARY:
                case proto.SQLTypeID.BLOB:
                case proto.SQLTypeID.INTERVAL:
                case proto.SQLTypeID.INVALID:
                case proto.SQLTypeID.SQLNULL:
                case proto.SQLTypeID.UNKNOWN:
                case proto.SQLTypeID.ANY:
                case proto.SQLTypeID.POINTER:
                case proto.SQLTypeID.HASH:
                case proto.SQLTypeID.STRUCT:
                case proto.SQLTypeID.LIST:
                    columnProxies.push(returnNull);
                    break;
            }
        }
        this._ctor = defineRowProxyType(columnNames, columnProxies);
    }

    // Index the chunk data
    public static indexChunkData(chunk: webdb.QueryResultChunk) {
        let tmp = new TmpBuffers();
        const data: ChunkData = {
            columns: [],
            nullmasks: [],
            partitionBoundaries: chunk.partitionBoundariesArray() || null,
        };
        for (let columnId = 0; columnId < chunk.columnsLength(); ++columnId) {
            const column = chunk.columns(columnId)!;
            switch (column.variantType()) {
                case proto.VectorVariant.VectorU8: {
                    const vec = column.variant(tmp.vectorU8)!;
                    data.columns.push(vec.valuesArray());
                    data.nullmasks.push(vec.nullMaskArray());
                    break;
                }
                case proto.VectorVariant.VectorF64: {
                    const vec = column.variant(tmp.vectorF64)!;
                    data.columns.push(vec.valuesArray());
                    data.nullmasks.push(vec.nullMaskArray());
                    break;
                }
                case proto.VectorVariant.VectorString: {
                    const vec = column.variant(tmp.vectorString)!;
                    data.columns.push(vec);
                    data.nullmasks.push(vec.nullMaskArray());
                    break;
                }

                case proto.VectorVariant.VectorI64: {
                    const vec = column.variant(tmp.vectorI64)!;
                    data.columns.push(vec);
                    data.nullmasks.push(vec.nullMaskArray());
                    break;
                }

                case proto.VectorVariant.VectorI128: {
                    const vec = column.variant(tmp.vectorI128)!;
                    data.columns.push(vec);
                    data.nullmasks.push(vec.nullMaskArray());
                    break;
                }

                case proto.VectorVariant.NONE:
                case proto.VectorVariant.VectorInterval:
                    data.columns.push(null);
                    data.nullmasks.push(null);
                    break;
            }
        }
        return data;
    }

    /// Create an empty row
    public createEmptyRow<T extends RowProxy>(): T {
        const data: ChunkData = {
            columns: [],
            nullmasks: [],
            partitionBoundaries: null,
        };
        const n = this._result.columnTypesLength();
        for (let i = 0; i < n; ++i) {
            const nullmask = new Int8Array(1);
            nullmask[0] = 1;
            data.columns.push(null);
            data.nullmasks.push(nullmask);
        }
        return this._ctor(data, 0) as T;
    }

    /// Proxy a single chunk row
    public proxyChunkRow<T extends RowProxy>(chunk: webdb.QueryResultChunk | null): T {
        if (!chunk || chunk.rowCount() == 0) {
            return this.createEmptyRow<T>();
        }
        const data = RowProxyType.indexChunkData(chunk);
        return this._ctor(data, 0) as T;
    }

    // Proxy rows in chunk
    public proxyChunkRows<T extends RowProxy>(chunk: webdb.QueryResultChunk | null, out: T[] = []): T[] {
        if (!chunk) return out;
        const data = RowProxyType.indexChunkData(chunk);
        for (let rowId = 0; rowId < chunk.rowCount(); ++rowId) {
            out.push(this._ctor(data, rowId) as T);
        }
        return out;
    }
}
