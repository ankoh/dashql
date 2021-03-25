// Copyright (c) 2020 The DashQL Authors

import { webdb as proto } from '@dashql/proto';
import { ChunkIterator } from './chunk_iterator';

/**
 * An iterator that can be rewinded
 */
export interface RewindableIterator {
    rewind(): void;
}

/**
 * Check if an iterator is rewindable
 */
export function isRewindableIterator(iter: any): iter is RewindableIterator {
    return typeof iter['rewind'] == 'function';
}

/**
 * A higher-order iterator that buffers data from a chunk iterator
 */
export class MaterializingChunkIterator extends ChunkIterator implements RewindableIterator {
    /** The iterator */
    _iterator: ChunkIterator;
    /** The buffered chunks */
    _chunks: proto.QueryResultChunk[];
    /** Is the iterator depleted? */
    _depleted: boolean;

    public constructor(iter: ChunkIterator) {
        super(iter.result);
        this._iterator = iter;
        this._chunks = [];
        this._depleted = false;
    }

    /** Restart the chunk iterator */
    public rewind() {
        this._nextChunkID = 0;
    }

    /** Return the next buffered chunk */
    protected nextBuffered(): boolean {
        if (this._nextChunkID >= this._chunks.length) {
            return false;
        }
        this._currentChunk = this._chunks[this._nextChunkID++];
        return true;
    }

    /** Get the next chunk */
    public nextBlocking(): boolean {
        // Already depleted?
        if (this._nextChunkID < this._chunks.length || this._depleted) {
            return this.nextBuffered();
        }

        // Otherwise ask the iterator for more data
        if (this._iterator.nextBlocking()) {
            this._currentChunk = this._iterator.currentChunk!;
            this._chunks.push(this._currentChunk);
            this._nextChunkID++;
            return true;
        } else {
            this._depleted = true;
            return false;
        }
    }

    /** Get the next chunk asynchronously */
    public async nextAsync(): Promise<boolean> {
        // Already depleted?
        if (this._depleted) {
            return this.nextBuffered();
        }

        // Otherwise ask the iterator for more data
        if (await this._iterator.nextAsync()) {
            this._currentChunk = this._iterator.currentChunk!;
            this._chunks.push(this._currentChunk);
            this._nextChunkID++;
            return true;
        } else {
            this._depleted = true;
            return false;
        }
    }
}
