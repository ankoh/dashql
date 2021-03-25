// Copyright (c) 2020 The DashQL Authors

import { webdb as proto } from '@dashql/proto';
import { ChunkIterator } from './chunk_iterator';
import { RewindableIterator } from './materializing_iterator';
import { RowProxy } from './proxy';
import { RowProxyIterator } from './proxy_iterator';

/**
 * An iterator for a chunk array
 */
export class StaticChunkIterator extends ChunkIterator implements RewindableIterator {
    /** The chunks */
    _chunks: proto.QueryResultChunk[];

    public constructor(resultBuffer: proto.QueryResult, additional: proto.QueryResultChunk[] = []) {
        super(resultBuffer);
        this._chunks = [];
        for (let i = 0; i < this.result.dataChunksLength(); ++i) {
            this._chunks.push(this.result.dataChunks(i)!);
        }
        for (let i = 0; i < additional.length; ++i) {
            this._chunks.push(additional[i]);
        }
    }

    /** Restart the chunk iterator */
    public rewind() {
        if (this._chunks.length == 0) return;
        this._currentChunk = this._chunks[0];
        this._nextChunkID = 1;
    }

    /** Get the next chunk */
    public nextBlocking(): boolean {
        if (this._nextChunkID >= this._chunks.length) {
            return false;
        }
        this._currentChunk = this._chunks[this._nextChunkID++];
        return true;
    }

    /** Get the next chunk asynchronously */
    public async nextAsync(): Promise<boolean> {
        console.error('The blocking array iterator does not support asynchronous iteration');
        return Promise.resolve(false);
    }

    /** Construct the static chunk iterator from the query result */
    public static FromResult(result: proto.QueryResult) {
        return new StaticChunkIterator(result);
    }

    /* Iterate over row proxies across all chunks */
    public iter<T extends RowProxy>(): Iterable<T> & { columns: string[] } {
        return new RowProxyIterator<T>(this);
    }
}
