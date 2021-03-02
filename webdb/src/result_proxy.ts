// Copyright (c) 2020 The DashQL Authors

import { webdb as proto } from '@dashql/proto';
import { SQLType, Value } from './value';
import { BlockingChunkIterator, VectorBuffers } from './iterator_base';

type ValueArray = Float64Array | proto.VectorString;

interface ChunkData {
    columns: (ValueArray | null)[];
    nullmasks: (Int8Array | null)[];
}

type IntegerAttributeProxy = (chunk: ChunkData, row: number) => number | null;
type FloatAttributeProxy = (chunk: ChunkData, row: number) => number | null;
type StringAttributeProxy = (chunk: ChunkData, row: number) => string | null;
type AttributeProxy = IntegerAttributeProxy | FloatAttributeProxy | StringAttributeProxy;

function Column<T>(column: number, fn: (column: number, chunk: ChunkData, row: number) => T) : (chunk: ChunkData, row: number) => T {
    return (chunk: ChunkData, row: number) => fn(column, chunk, row);
}

function Nullable<T>(fn: (column: number, chunk: ChunkData, row: number) => T): (column: number, chunk: ChunkData, row: number) => T | null {
    return (column: number, chunk: ChunkData, row: number) =>
        chunk.nullmasks[column]![row] ? null : fn(column, chunk, row);
}

function DoubleAsDouble(column: number, chunk: ChunkData, row: number): number | null {
    return (chunk.columns[column] as Float64Array)[row];
}
function DoubleAsInteger(column: number, chunk: ChunkData, row: number): number | null {
    return Math.trunc((chunk.columns[column] as Float64Array)[row]);
}
function DoubleAsString(column: number, chunk: ChunkData, row: number): string | null {
    return (chunk.columns[column] as Float64Array)[row].toString();
}

function StringAsDouble(column: number, chunk: ChunkData, row: number): number | null {
    return parseFloat((chunk.columns[column] as proto.VectorString).values(row));
}
function StringAsInteger(column: number, chunk: ChunkData, row: number): number | null {
    return parseInt((chunk.columns[column] as proto.VectorString).values(row));
}
function StringAsString(column: number, chunk: ChunkData, row: number): string | null {
    return (chunk.columns[column] as proto.VectorString).values(row);
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

export function proxyMaterializedChunkRows<T>(iter: BlockingChunkIterator): T[] {
    let columnNames: string[] = [];
    let columnProxies: AttributeProxy[] = [];
    for (let columnId = 0; columnId < iter.columnCount; ++columnId) {
        switch (iter.columnTypes[columnId].typeId()) {
            case proto.SQLTypeID.BOOLEAN:
                break;

            case proto.SQLTypeID.TINYINT:
            case proto.SQLTypeID.SMALLINT:
            case proto.SQLTypeID.INTEGER: {
                columnProxies.push(Column(columnId, Nullable(DoubleAsInteger)));
                columnNames.push(iter.result.columnNames(columnId));
                break;
            }

            case proto.SQLTypeID.FLOAT:
            case proto.SQLTypeID.DOUBLE: {
                columnProxies.push(Column(columnId, Nullable(DoubleAsDouble)));
                columnNames.push(iter.result.columnNames(columnId));
                break;
            }

            case proto.SQLTypeID.CHAR:
            case proto.SQLTypeID.VARCHAR: {
                columnProxies.push(Column(columnId, Nullable(StringAsString)));
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

    const tmpVectorF64 = new proto.VectorF64();

    // Collect all chunks
    let rows: T[] = []
    while (iter.nextBlocking()) {
        const chunk = iter.currentChunk;
        const chunkData: ChunkData = {
            columns: [],
            nullmasks: []
        };
        for (let columnId = 0; columnId < chunk.columnsLength(); ++columnId) {
            const column = chunk.columns(columnId)!;
            switch (column.variantType()) {
                case proto.VectorVariant.NONE:
                    break;
                case proto.VectorVariant.VectorF64: {
                    const vec = column.variant(tmpVectorF64)!;
                    chunkData.columns.push(vec.valuesArray());
                    chunkData.nullmasks.push(vec.nullMaskArray());
                    break;
                }
                case proto.VectorVariant.VectorI128:
                    break;
                case proto.VectorVariant.VectorI64:
                    break;
                case proto.VectorVariant.VectorInterval:
                    break;
                case proto.VectorVariant.VectorString:
                    const vec = column.variant(new proto.VectorString)!;
                    chunkData.columns.push(vec);
                    chunkData.nullmasks.push(vec.nullMaskArray());
                    break;
                case proto.VectorVariant.VectorU8:
                    break;
            }
        }
        for (let rowId = 0; rowId < chunk.rowCount(); ++rowId) {
            rows.push(rowProxyCtor(chunkData, rowId) as T);
        }
    }
    return rows;
}
