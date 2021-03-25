// Copyright (c) 2020 The DashQL Authors

import { ChunkIterator } from '../common/chunk_iterator';
import { WebDBConnection } from '../bindings';
import { webdb as proto } from '@dashql/proto';
import { RowProxy } from '../common/proxy';
import { RowProxyIterator } from '../common/proxy_iterator';

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
        const result = this._resultBuffer;
        const next = this._nextChunkID++;
        if (next < result.dataChunksLength()) {
            this._currentChunk = result.dataChunks(next, this._currentChunk!)!;
        } else {
            let chunkBuffer = this._connection.fetchQueryResults();
            this._currentChunk = chunkBuffer;
        }
        return this._currentChunk.rowCount() > 0;
    }
    /** Get the next chunk asynchronously */
    public async nextAsync(): Promise<boolean> {
        return Promise.resolve(false);
    }

    /* Iterate over row proxies across all chunks */
    public iter<T extends RowProxy>(): Iterable<T> & { columns: string[] } {
        return new RowProxyIterator<T>(this);
    }
}
