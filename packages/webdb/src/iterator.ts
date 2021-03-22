// Copyright (c) 2020 The DashQL Authors

import { ChunkIterator, RewindableIterator } from './iterator_base';
import { WebDBConnection } from './webdb_bindings';
import { webdb as proto } from '@dashql/proto';

/**
 * An iterator for blocking chunk streams
 */
export class ChunkStreamIterator extends ChunkIterator {
    /** The connection */
    _connection: WebDBConnection;

    /** Constructor */
    public constructor(connection: WebDBConnection, resultBuffer: proto.QueryResult) {
        super(resultBuffer);
        this._connection = connection;
    }

    /** Get the next chunk */
    public nextBlocking(): boolean {
        let result = this._resultBuffer;
        if (++this._currentChunkID < result.dataChunksLength()) {
            this._currentChunk = result.dataChunks(this._currentChunkID, this._currentChunk!)!;
        } else {
            let chunkBuffer = this._connection.fetchQueryResults();
            this._currentChunk = chunkBuffer;
        }
        return this._currentChunk.rowCount() > 0;
    }
    /** Get the next chunk asynchronously */
    public async nextAsync(): Promise<boolean> {
        console.error('The blocking stream iterator does not support asynchronous iteration');
        return Promise.resolve(false);
    }
}

/**
 * An iterator for a chunk array
 */
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
        this._currentChunkID = -1;
    }

    /** Get the next chunk */
    public nextBlocking(): boolean {
        if (this._currentChunkID + 1 >= this._chunks.length) {
            return false;
        }
        ++this._currentChunkID;
        this._currentChunk = this._chunks[this._currentChunkID];
        return true;
    }

    /** Get the next chunk asynchronously */
    public async nextAsync(): Promise<boolean> {
        console.error('The blocking array iterator does not support asynchronous iteration');
        return Promise.resolve(false);
    }
}
