// Copyright (c) 2020 The DashQL Authors

import { ChunkIterator, RewindableIterator } from '../common/iterator_base';
import { AsyncConnection } from './async_webdb';
import { webdb as proto } from '@dashql/proto';

/** An iterator for async chunk streams */
export class ChunkStreamIterator extends ChunkIterator {
    /** The connection */
    _connection: AsyncConnection;

    public constructor(connection: AsyncConnection, resultBuffer: proto.QueryResult) {
        super(resultBuffer);
        this._connection = connection;
    }

    /** Get the next chunk synchronously */
    public nextBlocking(): boolean {
        console.error('The asynchronous stream iterator does not support blocking iteration');
        return false;
    }

    /** Get the next chunk asynchronously */
    public async nextAsync(): Promise<boolean> {
        const result = this._resultBuffer;
        const next = this._nextChunkID++;
        if (next < result.dataChunksLength()) {
            this._currentChunk = result.dataChunks(next, this._currentChunk!)!;
        } else {
            let chunkBuffer = await this._connection.fetchQueryResults();
            this._currentChunk = chunkBuffer;
        }
        return this._currentChunk.rowCount() > 0;
    }
}

/** An iterator for a chunk array */
export class ChunkArrayIterator extends ChunkIterator implements RewindableIterator {
    /** The chunks */
    _chunks: proto.QueryResultChunk[];

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

    /** Restart the chunk iterator */
    public rewind() {
        this._nextChunkID = 0;
    }

    /** Get the next chunk synchronous */
    public nextBlocking(): boolean {
        if (this._nextChunkID >= this._chunks.length) {
            return false;
        }
        this._currentChunk = this._chunks[this._nextChunkID++];
        return true;
    }

    /** Get the next chunk */
    public async nextAsync(): Promise<boolean> {
        if (this._nextChunkID >= this._chunks.length) {
            return false;
        }
        this._currentChunk = this._chunks[this._nextChunkID++];
        return true;
    }
}
