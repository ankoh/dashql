// Copyright (c) 2020 The DashQL Authors

import { ChunkIterator } from '../common/chunk_iterator';
import { AsyncConnection } from './async_duckdb';
import { duckdb as proto } from '@dashql/proto';

/** An iterator for async chunk streams */
export class AsyncChunkStreamIterator extends ChunkIterator {
    public constructor(protected connection: AsyncConnection, resultBuffer: proto.QueryResult) {
        super(resultBuffer);
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
            let chunkBuffer = await this.connection.fetchQueryResults();
            this._currentChunk = chunkBuffer;
        }
        return this._currentChunk!.rowCount() > 0;
    }
}
