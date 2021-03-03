// Copyright (c) 2020 The DashQL Authors

import {
    ChunkIterator,
} from './iterator_base';
import { AsyncConnection } from './async_webdb';
import { webdb as proto } from '@dashql/proto';

/// An iterator for async chunk streams
export class ChunkStreamIterator extends ChunkIterator {
    /// The connection
    _connection: AsyncConnection;

    /// Constructor
    public constructor(connection: AsyncConnection, resultBuffer: proto.QueryResult) {
        super(resultBuffer);
        this._connection = connection;
    }

    /// Get the next chunk synchronously
    public nextBlocking(): boolean {
        console.error("The asynchronous stream iterator does not support blocking iteration");
        return false;
    }

    /// Get the next chunk asynchronously
    public async nextAsync(): Promise<boolean> {
        let result = this._resultBuffer;
        if (++this._currentChunkID < result.dataChunksLength()) {
            this._currentChunk = result.dataChunks(this._currentChunkID, this._currentChunk!)!;
        } else {
            let chunkBuffer = await this._connection.fetchQueryResults();
            this._currentChunk = chunkBuffer;
        }
        return this._currentChunk.rowCount() > 0;
    }
}

/// An iterator for a chunk array
export class ChunkArrayIterator extends ChunkIterator {
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

    /// Get the current chunk (if available)
    public get currentChunk() {
        return this._chunks[this._currentChunkID];
    }
    /// Restart the chunk iterator
    public rewind() {
        this._currentChunkID = -1;
    }
    /// The the next chunk synchronous
    public nextBlocking(): boolean {
        if (this._currentChunkID + 1 >= this._chunks.length) {
            return false;
        }
        this._currentChunk = this._chunks[++this._currentChunkID];
        return true;
    }
    /// Get the next chunk
    public async nextAsync(): Promise<boolean> {
        if (this._currentChunkID + 1 >= this._chunks.length) {
            return false;
        }
        this._currentChunk = this._chunks[++this._currentChunkID];
        return true;
    }
}