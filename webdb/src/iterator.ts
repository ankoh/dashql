// Copyright (c) 2020 The DashQL Authors

import { ChunkIteratorBase, BlockingChunkIterator } from './iterator_base';
import { WebDBConnection } from './webdb_bindings';
import { webdb as proto } from '@dashql/proto';

/// A stream of query result chunks
export class QueryResultChunkStream extends ChunkIteratorBase implements BlockingChunkIterator {
    /// The connection
    _connection: WebDBConnection;
    /// The current chunk buffer
    _currentChunkBuffer: proto.QueryResultChunk | null;

    /// Constructor
    public constructor(connection: WebDBConnection, resultBuffer: proto.QueryResult) {
        super(resultBuffer);
        this._connection = connection;
        this._currentChunkBuffer = null;
    }

    /// Get the next chunk
    public nextBlocking(): boolean {
        let result = this._resultBuffer;
        if (++this._currentChunkID < result.dataChunksLength()) {
            this._currentChunk = result.dataChunks(this._currentChunkID, this._currentChunk!)!;
        } else {
            let chunkBuffer = this._connection.fetchQueryResults();
            this._currentChunk = chunkBuffer;
            this._currentChunkBuffer = chunkBuffer;
        }
        return this._currentChunk.rowCount() > 0;
    }
}

/// Materialized result chunks
export class MaterializedQueryResultChunks extends ChunkIteratorBase implements BlockingChunkIterator {
    /// The chunks
    _chunks: proto.QueryResultChunk[];

    /// Constructor
    public constructor(resultBuffer: proto.QueryResult, chunks: proto.QueryResultChunk[] = []) {
        super(resultBuffer);
        this._chunks = [];
        for (let i = 0; i < this.result.dataChunksLength(); ++i) {
            this._chunks.push(this.result.dataChunks(i)!);
        }
        for (let i = 0; i < chunks.length; ++i) {
            this._chunks.push(chunks[i]);
        }
        if (this._chunks.length == 0 || this._chunks[this._chunks.length - 1].rowCount() == 0) {
            this._chunks.push(new proto.QueryResultChunk());
        }
    }

    /// Restart the chunk iterator
    public rewind() {
        this._currentChunkID = -1;
    }
    /// Get the next chunk
    public nextBlocking(): boolean {
        if (this._currentChunkID + 1 >= this._chunks.length) {
            return false;
        }
        ++this._currentChunkID;
        this._currentChunk = this._chunks[this._currentChunkID];
        return true;
    }
}