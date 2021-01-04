// Copyright (c) 2020 The DashQL Authors

import { IteratorBase } from './iterator_base';
import { AsyncWebDBConnection } from './async_webdb';

import { Value } from './value';
import { webdb as proto } from '@dashql/proto';

/// An abstract chunk iterator
export abstract class QueryResultChunkIterator extends IteratorBase {
    /// The connection
    _connection: AsyncWebDBConnection;

    /// Constructor
    public constructor(connection: AsyncWebDBConnection, resultBuffer: proto.QueryResult) {
        super(resultBuffer);
        this._connection = connection;
    }

    /// Get the next query result chunk
    public abstract next(): Promise<boolean>;
}

/// A stream of query result chunks
export class QueryResultChunkStream extends QueryResultChunkIterator {
    /// The current chunk buffer
    _currentChunkBuffer: proto.QueryResultChunk | null;

    /// Constructor
    public constructor(connection: AsyncWebDBConnection, resultBuffer: proto.QueryResult) {
        super(connection, resultBuffer);
        this._currentChunkBuffer = null;
    }

    /// Get the next chunk
    public async next(): Promise<boolean> {
        let result = this._resultBuffer;
        if (++this._currentChunkID < result.dataChunksLength()) {
            result.dataChunks(0, this._currentChunk);
        } else {
            let chunkBuffer = await this._connection.fetchQueryResults();
            this._currentChunk = chunkBuffer;
            this._currentChunkBuffer = chunkBuffer;
        }
        return this._currentChunk.rowCount().low > 0;
    }
}

/// Materialized result chunks
export class MaterializedQueryResultChunks extends QueryResultChunkIterator {
    /// The chunks
    _chunks: proto.QueryResultChunk[];

    /// Constructor
    public constructor(connection: AsyncWebDBConnection, resultBuffer: proto.QueryResult, chunks: proto.QueryResultChunk[]) {
        super(connection, resultBuffer);
        this._chunks = [];
        for (let i = 0; i < this.result.dataChunksLength(); ++i) {
            this._chunks.push(this.result.dataChunks(i)!);
        }
        for (let i = 0; i < chunks.length; ++i) {
            this._chunks.push(chunks[i]);
        }
        if (this._chunks.length == 0 || this._chunks[this._chunks.length - 1].rowCount().low == 0)  {
            this._chunks.push(new proto.QueryResultChunk());
        }
    }

    /// Restart  the chunk iterator
    public rewind() { this._currentChunkID = -1; }
    /// Get the next chunk
    public async next(): Promise<boolean> {
        this._currentChunkID = Math.min(this._currentChunkID + 1, this._chunks.length - 1);
        this._currentChunk = this._chunks[this._currentChunkID];
        return this._currentChunk.rowCount().low > 0;
    }
}

/// A query result row iterator
export class QueryResultRowIterator {
    /// The query result
    _chunkIter: QueryResultChunkIterator;
    /// The global row index
    _globalRowIndex: number;
    /// The chunk row begin
    _currentChunkBegin: number;

    /// Constructor
    protected constructor(resultChunks: QueryResultChunkIterator) {
        this._chunkIter = resultChunks;
        this._globalRowIndex = 0;
        this._currentChunkBegin = 0;
    }

    /// Iterate over a result buffer
    public static async iterate(resultChunks: QueryResultChunkIterator): Promise<QueryResultRowIterator> {
        let iter = new QueryResultRowIterator(resultChunks);
        await resultChunks.next();
        iter._currentChunkBegin = 0;
        return iter;
    }

    /// Get the chunk row
    public get currentRow() { return this._globalRowIndex - this._currentChunkBegin; }
    /// Get the current chunk
    public get currentChunk(): proto.QueryResultChunk { return this._chunkIter.currentChunk; }
    /// Get the temporary buffers
    public get tmp() { return this._chunkIter.tmp; }

    /// Get the column count
    public getColumnName(idx: number) { return this._chunkIter.result.columnNames(idx); }
    /// Is the end?
    public isEnd(): boolean { return this.currentRow >= this.currentChunk.rowCount().low; }

    /// Advance the iterator
    public async next(): Promise<boolean> {
        // Reached end?
        if (this.isEnd())
            return false;

        // Still in current chunk?
        ++this._globalRowIndex;
        if (this.currentRow < this.currentChunk.rowCount().low)
            return true;

        // Get next chunk
        await this._chunkIter.next();
        this._currentChunkBegin = this._globalRowIndex;
        let empty = this.currentChunk.rowCount().low == 0;
        return !empty;
    }

    /// Get a value
    public getValue(cid: number, v: Value): Value {
        if (cid >= this._chunkIter.columnCount) {
            throw Error("column index out of bounds");
        }
        v.sqlType = this._chunkIter.columnTypes[cid];
        let r = this.currentRow;

        // Read the vector
        let c = this.currentChunk.columns(cid, this.tmp.vector);
        if (c == null) {
            v.nullFlag = true;
            return v;
        }
        switch (c.variantType()) {
            case proto.VectorVariant.NONE:
                break;
            case proto.VectorVariant.VectorI8:
                c.variant(this.tmp.vectorI8);
                v.asNumber().value = this.tmp.vectorI8.values(r)!;
                v.nullFlag = this.tmp.vectorI8.nullMask(r)!;
                break;
            case proto.VectorVariant.VectorU8:
                c.variant(this.tmp.vectorU8);
                v.asNumber().value = this.tmp.vectorU8.values(r)!;
                v.nullFlag = this.tmp.vectorU8.nullMask(r)!;
                break;
            case proto.VectorVariant.VectorI16:
                c.variant(this.tmp.vectorI16);
                v.asNumber().value = this.tmp.vectorI16.values(r)!;
                v.nullFlag = this.tmp.vectorI16.nullMask(r)!;
                break;
            case proto.VectorVariant.VectorU16:
                c.variant(this.tmp.vectorU16);
                v.asNumber().value = this.tmp.vectorU16.values(r)!;
                v.nullFlag = this.tmp.vectorU16.nullMask(r)!;
                break;
            case proto.VectorVariant.VectorI32:
                c.variant(this.tmp.vectorI32);
                v.asNumber().value = this.tmp.vectorI32.values(r)!;
                v.nullFlag = this.tmp.vectorI32.nullMask(r)!;
                break;
            case proto.VectorVariant.VectorU32:
                c.variant(this.tmp.vectorU32);
                v.asNumber().value = this.tmp.vectorU32.values(r)!;
                v.nullFlag = this.tmp.vectorU32.nullMask(r)!;
                break;
            case proto.VectorVariant.VectorI64:
                c.variant(this.tmp.vectorI64);
                v.asLong().value = this.tmp.vectorI64.values(r)!;
                v.nullFlag = this.tmp.vectorI64.nullMask(r)!;
                break;
            case proto.VectorVariant.VectorU64:
                c.variant(this.tmp.vectorU64);
                v.asLong().value = this.tmp.vectorU64.values(r)!;
                v.nullFlag = this.tmp.vectorU64.nullMask(r)!;
                break;
            case proto.VectorVariant.VectorI128:
                c.variant(this.tmp.vectorI128);
                this.tmp.vectorI128.values(r, v.asI128().value)!;
                v.nullFlag = this.tmp.vectorI128.nullMask(r)!;
                break;
            case proto.VectorVariant.VectorF32:
                c.variant(this.tmp.vectorF32);
                v.asNumber().value = this.tmp.vectorF32.values(r)!;
                v.nullFlag = this.tmp.vectorF32.nullMask(r)!;
                break;
            case proto.VectorVariant.VectorF64:
                c.variant(this.tmp.vectorF64);
                v.asNumber().value = this.tmp.vectorF64.values(r)!;
                v.nullFlag = this.tmp.vectorF64.nullMask(r)!;
                break;
            case proto.VectorVariant.VectorInterval:
                c.variant(this.tmp.vectorInterval);
                this.tmp.vectorInterval.values(r, v.asInterval().value)!;
                v.nullFlag = this.tmp.vectorInterval.nullMask(r)!;
                break;
            case proto.VectorVariant.VectorString:
                c.variant(this.tmp.vectorString);
                v.asString().value = this.tmp.vectorString.values(r)!;
                v.nullFlag = this.tmp.vectorString.nullMask(r)!;
                break;
        }
        return v;
    }
}
