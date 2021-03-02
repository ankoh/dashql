// Copyright (c) 2020 The DashQL Authors

import { webdb as proto, webdb } from '@dashql/proto';

type ValueArray = Float64Array | proto.VectorString;

interface ChunkData {
    columns: (ValueArray | null)[];
    nullmasks: (Int8Array | null)[];
}

type IntegerAttributeProxy = (chunk: ChunkData, row: number) => number | null;
type FloatAttributeProxy = (chunk: ChunkData, row: number) => number | null;
type StringAttributeProxy = (chunk: ChunkData, row: number) => string | null;
type AttributeProxy = IntegerAttributeProxy | FloatAttributeProxy | StringAttributeProxy;

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

/// Define a row proxy type
function defineRowProxyType(columnNames: string[], columnProxies: AttributeProxy[]): RowProxyCtor {
    const ctor = function (this: any, chunk: ChunkData, row: number) {
        this.__chunk__ = chunk;
        this.__row__ = row;
    };
    Object.defineProperty(ctor.prototype, '__chunk__', {
        enumerable: false,
        writable: true,
    });
    Object.defineProperty(ctor.prototype, '__row__', {
        value: -1,
        enumerable: false,
        writable: true,
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
    return (chunk: ChunkData, row: number) => new (ctor as any)(chunk, row);
}

export class RowProxyType<T> {
    /// The row constructor
    _ctor: RowProxyCtor;

    /// Constructor
    constructor(result: proto.QueryResult) {
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

                case proto.SQLTypeID.BOOLEAN:
                case proto.SQLTypeID.DATE:
                case proto.SQLTypeID.TIME:
                case proto.SQLTypeID.TIMESTAMP:
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
                    columnProxies.push(returnNull);
                    break;
            }
        }
        this._ctor = defineRowProxyType(columnNames, columnProxies);
    }

    // Proxy rows in chunk
    public proxyChunkRows(chunk: webdb.QueryResultChunk, out: T[] = []): T[] {
        const tmpVectorF64 = new proto.VectorF64();
        const chunkData: ChunkData = {
            columns: [],
            nullmasks: [],
        };
        for (let columnId = 0; columnId < chunk.columnsLength(); ++columnId) {
            const column = chunk.columns(columnId)!;
            switch (column.variantType()) {
                case proto.VectorVariant.VectorF64: {
                    const vec = column.variant(tmpVectorF64)!;
                    chunkData.columns.push(vec.valuesArray());
                    chunkData.nullmasks.push(vec.nullMaskArray());
                    break;
                }
                case proto.VectorVariant.VectorString: {
                    const vec = column.variant(new proto.VectorString())!;
                    chunkData.columns.push(vec);
                    chunkData.nullmasks.push(vec.nullMaskArray());
                    break;
                }

                case proto.VectorVariant.NONE:
                case proto.VectorVariant.VectorI64:
                case proto.VectorVariant.VectorI128:
                case proto.VectorVariant.VectorInterval:
                case proto.VectorVariant.VectorU8:
                    chunkData.columns.push(null);
                    chunkData.nullmasks.push(null);
                    break;
            }
        }
        for (let rowId = 0; rowId < chunk.rowCount(); ++rowId) {
            out.push(this._ctor(chunkData, rowId) as T);
        }
        return out;
    }
}
