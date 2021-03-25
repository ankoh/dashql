import { ChunkIterator } from './chunk_iterator';
import { isRewindableIterator } from './materializing_iterator';
import { RowProxyType, RowProxy, ChunkData } from './proxy';

/** An iterator for row proxies of a chunk iterator. */
export class RowProxyIterator<T extends RowProxy> implements Iterable<RowProxy> {
    private nextRowID: number = 0;
    private currentChunkData: ChunkData | null = null;
    private proxyType: RowProxyType;
    /** The column names in the proxy. */
    public get columns() {
        return this.proxyType.columnNames;
    }

    constructor(private chunkIterator: ChunkIterator) {
        this.proxyType = chunkIterator.proxyType();
        if (chunkIterator.nextBlocking()) {
            this.currentChunkData = RowProxyType.indexChunkData(chunkIterator.currentChunk!);
        }
    }

    /* Get the next result from the iterator. */
    next(): IteratorResult<T> {
        // No chunk available?
        const { chunkIterator } = this;
        if (!chunkIterator.currentChunk) {
            return { done: true, value: null };
        }

        // Still in bounds?
        const row = this.nextRowID++;
        if (row < this.chunkIterator.currentChunk!.rowCount()) {
            return {
                value: this.proxyType!.proxyRow<T>(this.currentChunkData!, row),
            };
        }
        // Try to fetch next chunk
        this.nextRowID = 0;
        if (!chunkIterator.nextBlocking() || chunkIterator.currentChunk.rowCount() === 0) {
            this.currentChunkData = null;
            return { done: true, value: null };
        }
        this.currentChunkData = RowProxyType.indexChunkData(chunkIterator.currentChunk);
        return this.next();
    }

    [Symbol.iterator]() {
        if (isRewindableIterator(this.chunkIterator)) {
            this.chunkIterator.rewind();
        }
        return this;
    }
}
