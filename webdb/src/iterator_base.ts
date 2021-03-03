// Copyright (c) 2020 The DashQL Authors

import { webdb as proto, webdb } from '@dashql/proto';
import { Value } from './value';
import { RowProxyType, RowProxy } from './proxy';

/// The vector buffers
class TmpBuffers {
    vector: proto.Vector;
    vectorU8: proto.VectorU8;
    vectorI64: proto.VectorI64;
    vectorI128: proto.VectorI128;
    vectorF64: proto.VectorF64;
    vectorInterval: proto.VectorInterval;
    vectorString: proto.VectorString;

    /// Constructor
    constructor() {
        this.vector = new proto.Vector();
        this.vectorU8 = new proto.VectorU8();
        this.vectorI64 = new proto.VectorI64();
        this.vectorI128 = new proto.VectorI128();
        this.vectorF64 = new proto.VectorF64();
        this.vectorInterval = new proto.VectorInterval();
        this.vectorString = new proto.VectorString();
    }
}

/// A chunk iterator base class
export abstract class ChunkIteratorBase {
    /// The result buffer
    _resultBuffer: proto.QueryResult;
    /// The chunk id
    _currentChunkID: number;
    /// The current chunk
    _currentChunk: proto.QueryResultChunk | null;
    /// The column types
    _columnTypes: proto.SQLType[];
    /// The row type
    _proxyType: RowProxyType | null;
    /// The temporary flatbuffer objects
    _tmp: TmpBuffers;

    /// Constructor
    public constructor(resultBuffer: proto.QueryResult) {
        this._resultBuffer = resultBuffer;
        this._currentChunkID = -1;
        this._currentChunk = null;
        this._columnTypes = new Array<proto.SQLType>();
        this._proxyType = null;
        this._tmp = new TmpBuffers();

        // Collect the column types
        for (let i = 0; i < this.result.columnTypesLength(); ++i) {
            let t = new proto.SQLType();
            this.result.columnTypes(i, t);
            this._columnTypes.push(t);
        }
    }
    /// Get the result
    public get result() { return this._resultBuffer; }
    /// Get the column count
    public get columnCount() { return this._columnTypes.length; }
    /// Get the column count
    public get columnTypes() { return this._columnTypes; }
    /// Get the row count
    public get rowCount() { return this._currentChunk?.rowCount() || 0; }
    /// Get the current chunk
    public get currentChunk() { return this._currentChunk; }
    /// Get the temporary buffers
    public get tmp() { return this._tmp; }

    /// Build the row proxies
    public collect<T extends RowProxy>(out: T[] = []): T[]  {
        if (!this._proxyType) {
            this._proxyType = new RowProxyType(this.result);
        }
        return this._proxyType.proxyChunkRows<T>(this.currentChunk, out);
    }

    /// Collect exactly one entry
    public collectOne<T extends RowProxy>(): T {
        if (!this._proxyType) {
            this._proxyType = new RowProxyType(this.result);
        }
        return this._proxyType.proxyChunkRow<T>(this.currentChunk);
    }

    /// Read a value of a row
    public readValue(rid = 0, cid: number = 0, v: Value = new Value()): Value {
        v.sqlType = this.columnTypes[cid];
        let c = this.currentChunk?.columns(cid, this.tmp.vector);
        if (c == null) {
            v.setNull();
            return v;
        }
        switch (c.variantType()) {
            case proto.VectorVariant.NONE:
                break;
            case proto.VectorVariant.VectorU8:
                c.variant(this.tmp.vectorU8);
                v.setNumber(this.tmp.vectorU8.values(rid)!);
                v.setNull(this.tmp.vectorU8.nullMask(rid)!);
                break;
            case proto.VectorVariant.VectorI64:
                c.variant(this.tmp.vectorI64);
                v.setLong(this.tmp.vectorI64.values(rid)!);
                v.setNull(this.tmp.vectorI64.nullMask(rid)!);
                break;
            case proto.VectorVariant.VectorF64:
                c.variant(this.tmp.vectorF64);
                v.setNumber(this.tmp.vectorF64.values(rid)!);
                v.setNull(this.tmp.vectorF64.nullMask(rid)!);
                break;
            case proto.VectorVariant.VectorI128:
                c.variant(this.tmp.vectorI128);
                v.setI128(this.tmp.vectorI128.values(rid)!);
                v.setNull(this.tmp.vectorI128.nullMask(rid)!);
                break;
            case proto.VectorVariant.VectorInterval:
                c.variant(this.tmp.vectorInterval);
                v.setInterval(this.tmp.vectorInterval.values(rid)!);
                v.setNull(this.tmp.vectorInterval.nullMask(rid)!);
                break;
            case proto.VectorVariant.VectorString:
                c.variant(this.tmp.vectorString);
                v.setString(this.tmp.vectorString.values(rid)!);
                v.setNull(this.tmp.vectorString.nullMask(rid)!);
                break;
        }
        return v;
    }

    /// Iterate over a number column
    public iterateNumberColumn(cid: number, fn: (row: number, v: number | null) => void, ofs: number = 0, limit: number = 0) {
        if (cid >= this.columnCount) {
            throw Error("column index out of bounds");
        }
        let c = this.currentChunk?.columns(cid, this.tmp.vector);
        if (c == null) {
            return;
        }
        // XXX other types
        if (c.variantType() != proto.VectorVariant.VectorF64) {
            return;
        }
        let v = c.variant(this.tmp.vectorF64)!;
        const a: Float64Array | null = v.valuesArray();
        const n: Int8Array | null = v.nullMaskArray();
        if (a == null)
            return;
        const lb = ofs;
        const ub = (limit > 0) ? Math.min(lb + limit, a.length) : a.length;
        if (n != null) {
            for (let i = lb; i < ub; ++i) {
                fn(i, n[i] ? null : a[i]);
            }
        } else {
            for (let i = lb; i < ub; ++i) {
                fn(i, a[i]);
            }
        }
    }
}

/// A blocking chunk iterator
export interface BlockingChunkIterator extends ChunkIteratorBase {
    nextBlocking(): boolean;
}

export interface AsyncChunkIterator extends ChunkIteratorBase {
    nextAsync(): Promise<boolean>;
}

/// Helper to iterate over a blocking chunk iterator
export function iterateChunksBlocking(iter: BlockingChunkIterator, offset: number, limit: number, fn: (iter: BlockingChunkIterator, start: number, skipHere: number, rowsHere: number) => void) {
    let skip = offset;
    let remaining = limit;
    let start = 0;

    while (remaining && iter.nextBlocking()) {
        const chunkRows = iter.currentChunk!.rowCount();
        const skipHere = Math.min(skip, chunkRows);
        skip -= skipHere;
        if (skipHere == chunkRows) {
            continue;
        }
        const rowsHere = Math.min(chunkRows - skipHere, remaining);

        // Run the function
        fn(iter, start, skipHere, rowsHere);

        // Advance the chunk start
        start += chunkRows - skipHere;
        remaining -= rowsHere;
    }
}