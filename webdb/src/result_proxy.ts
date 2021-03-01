// Copyright (c) 2020 The DashQL Authors

import { webdb as proto } from '@dashql/proto';
import { SQLType, Value } from './value';
import { NumberArray } from './iterator_base';

export interface ColumnProxy {
    /// Cast value at index as float
    castAsFloat(i: number): number | null;
    /// Cast value at index as integer
    castAsInteger(i: number): number | null;
    /// Cast value at index as string
    castAsString(i: number): string | null;
}

class NumberColumnProxy<T extends NumberArray> implements ColumnProxy {
    /// The value arrays
    _valueArrays: T[] = [];
    /// The nullmask arrays
    _nullmaskArrays: Uint8Array[] = [];
    /// The array offsets
    _arrayOffsets: Uint32Array = new Uint32Array();

    /// Find an index in the chunks
    protected resolveIndex(i: number): [number, number] {
        return [0, 0];
    }

    /// Cast value at index as float
    public castAsFloat(i: number): number | null {
        const [chunk, idx] = this.resolveIndex(i);
        return this._valueArrays[chunk][idx];
    }

    /// Cast value at index as integer
    public castAsInteger(i: number): number | null {
        const [chunk, idx] = this.resolveIndex(i);
        return Math.trunc(this._valueArrays[chunk][idx]);
    }

    /// Cast value at index as string
    public castAsString(i: number): string | null {
        const [chunk, idx] = this.resolveIndex(i);
        return this._valueArrays[chunk][idx].toString();
    }
}

type IntegerAttributeProxy = (i: number) => number | null;
type FloatAttributeProxy = (i: number) => number | null;
type StringAttributeProxy = (i: number) => string | null;
type AttributeProxy = IntegerAttributeProxy | FloatAttributeProxy | StringAttributeProxy;

export interface RowProxy {
    [name: string]: AttributeProxy
}

function defineRowProxyType(columnNames: string[], columnProxies: AttributeProxy[]): (index: number) => RowProxy {
    const ctor = function(this: any, index: number) {
        this.__rowIndex__ = index;
    };
    Object.defineProperty(ctor.prototype, "__rowIndex__" , {
        value: -1,
        enumerable: false,
        writable: false,
    })
    for (let i = 0; i < columnProxies.length; ++i) {
        const proxy = columnProxies[i];
        Object.defineProperty(ctor.prototype, columnNames[i], {
            get: function() { return proxy(this.__rowIndex__) },
            enumerable: true
        })
    }
    return (index: number) => (new (ctor as any)(index));
}

export class MaterializedQueryResultBuffer {
    /// The query result
    _result: proto.QueryResult;
    /// The chunks
    _chunks: proto.QueryResultChunk[];
    /// The offsets of the chunks
    _chunkOffsets: Uint32Array;

    /// Constructor
    public constructor(resultBuffer: proto.QueryResult, chunks: proto.QueryResultChunk[] = []) {
        this._result = resultBuffer;
        this._chunks = [];
        this._chunkOffsets = new Uint32Array(this._result.dataChunksLength() + chunks.length);
        let globalOffset = 0;
        for (let i = 0; i < this._result.dataChunksLength(); ++i) {
            this._chunkOffsets[i] = globalOffset;
            this._chunks.push(this._result.dataChunks(i)!);
            globalOffset += this._chunks[i].rowCount();
        }
        for (let i = 0; i < chunks.length; ++i) {
            this._chunkOffsets[this._chunks.length] = globalOffset;
            this._chunks.push(chunks[i]);
            globalOffset += chunks[i].rowCount();
        }
        if (this._chunks.length == 0 || this._chunks[this._chunks.length - 1].rowCount() == 0) {
            this._chunks.push(new proto.QueryResultChunk());
        }
    }

    /// Build row proxies
    public buildRowProxies(): RowProxy[] {
        const columnNames: string[] = [];
        const columnProxies: AttributeProxy[] = [];
        const RowProxyType = defineRowProxyType(columnNames, columnProxies);
        let rows: RowProxy[] = [];
        for (let i = 0; i < 1000; ++i) {
            const row = RowProxyType(i);
            rows.push(row);
        }
        return rows;
    }
}
