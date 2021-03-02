// Copyright (c) 2020 The DashQL Authors

import { webdb as proto, webdb } from '@dashql/proto';
import { Value } from './value';
import { RowProxyType, RowProxy } from './proxy';

/// The vector buffers
export class VectorBuffers {
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
    _currentChunk: proto.QueryResultChunk;
    /// The column types
    _columnTypes: proto.SQLType[];
    /// The row type
    _proxyType: RowProxyType | null;
    /// The temporary flatbuffer objects
    _tmp: VectorBuffers;

    /// Constructor
    public constructor(resultBuffer: proto.QueryResult) {
        this._resultBuffer = resultBuffer;
        this._currentChunkID = -1;
        this._currentChunk = new proto.QueryResultChunk();
        this._columnTypes = new Array<proto.SQLType>();
        this._proxyType = null;
        this._tmp = new VectorBuffers();

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
    public get rowCount() { return this._currentChunk.rowCount(); }
    /// Get the current chunk
    public get currentChunk() { return this._currentChunk; }
    /// Get the temporary buffers
    public get tmp() { return this._tmp; }

    /// Iterate over a number column
    public iterateNumberColumn(cid: number, fn: (row: number, v: number | null) => void, ofs: number = 0, limit: number = 0) {
        if (cid >= this.columnCount) {
            throw Error("column index out of bounds");
        }
        let c = this.currentChunk.columns(cid, this.tmp.vector);
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

    /// Build the row proxies
    public collect<T extends RowProxy>(out: T[] = []): T[]  {
        if (!this._proxyType) {
            this._proxyType = new RowProxyType(this.result);
        }
        return this._proxyType.proxyChunkRows<T>(this.currentChunk, out);
    }
}

export interface BlockingChunkIterator extends ChunkIteratorBase {
    nextBlocking(): boolean;
}

/// Helper to iterate over a blocking chunk iterator
export function iterateChunksBlocking(iter: BlockingChunkIterator, offset: number, limit: number, fn: (iter: BlockingChunkIterator, start: number, skipHere: number, rowsHere: number) => void) {
    let skip = offset;
    let remaining = limit;
    let start = 0;

    while (remaining && iter.nextBlocking()) {
        const skipHere = Math.min(skip, iter.currentChunk.rowCount());
        skip -= skipHere;
        if (skipHere == iter.currentChunk.rowCount()) {
            continue;
        }
        const rowsHere = Math.min(iter.currentChunk.rowCount() - skipHere, remaining);

        // Run the function
        fn(iter, start, skipHere, rowsHere);

        // Advance the chunk start
        start += iter.currentChunk.rowCount() - skipHere;
        remaining -= rowsHere;
    }
}

export interface AsyncChunkIterator extends ChunkIteratorBase {
    nextAsync(): Promise<boolean>;
}

/// A row iterator base class
export abstract class RowIteratorBase {
    /// The query result
    _chunkIter: ChunkIteratorBase;
    /// The global row index
    _globalRowIndex: number = 0;
    /// The chunk row begin
    _currentChunkBegin: number = 0;

    constructor(iter: ChunkIteratorBase) {
        this._chunkIter = iter;
    }

    /// Get the temporary buffers
    public get tmp() { return this._chunkIter.tmp; }
    /// Get the chunk row
    public get currentRow() { return this._globalRowIndex - this._currentChunkBegin; }
    /// Get the current chunk
    public get currentChunk(): proto.QueryResultChunk { return this._chunkIter.currentChunk; }
    /// Get the column count
    public getColumnName(idx: number) { return this._chunkIter.result.columnNames(idx); }
    /// Is the end?
    public isEnd(): boolean { return this.currentRow >= this.currentChunk.rowCount(); }

    /// Read a value
    public getValue(cid: number = 0, v: Value = new Value()): Value {
        if (cid >= this._chunkIter.columnCount) {
            throw Error("column index out of bounds");
        }
        v.sqlType = this._chunkIter.columnTypes[cid];
        let r = this.currentRow;
        let c = this.currentChunk.columns(cid, this.tmp.vector);
        if (c == null) {
            v.setNull();
            return v;
        }
        switch (c.variantType()) {
            case proto.VectorVariant.NONE:
                break;
            case proto.VectorVariant.VectorU8:
                c.variant(this.tmp.vectorU8);
                v.setNumber(this.tmp.vectorU8.values(r)!);
                v.setNull(this.tmp.vectorU8.nullMask(r)!);
                break;
            case proto.VectorVariant.VectorI64:
                c.variant(this.tmp.vectorI64);
                v.setLong(this.tmp.vectorI64.values(r)!);
                v.setNull(this.tmp.vectorI64.nullMask(r)!);
                break;
            case proto.VectorVariant.VectorF64:
                c.variant(this.tmp.vectorF64);
                v.setNumber(this.tmp.vectorF64.values(r)!);
                v.setNull(this.tmp.vectorF64.nullMask(r)!);
                break;
            case proto.VectorVariant.VectorI128:
                c.variant(this.tmp.vectorI128);
                v.setI128(this.tmp.vectorI128.values(r)!);
                v.setNull(this.tmp.vectorI128.nullMask(r)!);
                break;
            case proto.VectorVariant.VectorInterval:
                c.variant(this.tmp.vectorInterval);
                v.setInterval(this.tmp.vectorInterval.values(r)!);
                v.setNull(this.tmp.vectorInterval.nullMask(r)!);
                break;
            case proto.VectorVariant.VectorString:
                c.variant(this.tmp.vectorString);
                v.setString(this.tmp.vectorString.values(r)!);
                v.setNull(this.tmp.vectorString.nullMask(r)!);
                break;
        }
        return v;
    }
}

export interface BlockingRowIterator {
    nextBlocking(): boolean;
}

export interface AsyncRowIterator {
    nextAsync(): Promise<boolean>;
}

/// A row iterator for materialized query results
export class BlockingQueryResultRowIterator extends RowIteratorBase implements BlockingRowIterator {
    /// Constructor
    protected constructor(chunks: BlockingChunkIterator) {
        super(chunks);
    }
    /// Get iterator
    public get iter() {
        return this._chunkIter as BlockingChunkIterator;
    }

    /// Iterate over a result buffer
    public static iterate(chunks: BlockingChunkIterator): BlockingQueryResultRowIterator {
        let iter = new BlockingQueryResultRowIterator(chunks);
        chunks.nextBlocking();
        iter._currentChunkBegin = 0;
        return iter;
    }

    /// Advance the iterator
    public nextBlocking(): boolean {
        // Reached end?
        if (this.isEnd()) return false;

        // Still in current chunk?
        ++this._globalRowIndex;
        if (this.currentRow < this.currentChunk.rowCount()) return true;

        // Get next chunk
        if (!this.iter.nextBlocking()) {
            return false;
        }
        this._currentChunkBegin = this._globalRowIndex;
        let empty = this.currentChunk.rowCount() == 0;
        return !empty;
    }
}