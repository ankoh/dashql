import * as proto from '@tigon/proto';

export class ChunkAccess {
    chunks: Array<proto.engine.QueryResultChunk>;
    lastChunk: number;

    /// Constructor
    constructor(chunks: Array<proto.engine.QueryResultChunk>) {
        this.chunks = chunks;
        this.lastChunk = 0;
    }

    /// Check a chunk
    protected cmpRange(
        chunk: proto.engine.QueryResultChunk,
        row: number,
    ): number {
        let begin = chunk.getRowOffset();
        let end = chunk.getRowOffset() + chunk.getRowCount();
        if (row >= begin && row < end) {
            return 0;
        } else if (row < begin) {
            return -1;
        } else {
            return 1;
        }
    }

    /// Does the last chunk contain a row?
    protected lastChunkContainsRow(row: number): boolean {
        return (
            this.lastChunk < this.chunks.length &&
            this.cmpRange(this.chunks[this.lastChunk], row) === 0
        );
    }

    /// Find a chunk
    public findChunk(row: number): proto.engine.QueryResultChunk | null {
        if (this.lastChunkContainsRow(row)) {
            return this.chunks[this.lastChunk];
        }
        let chunk: proto.engine.QueryResultChunk | null = null;
        let lb = 0;
        let ub = this.chunks.length;
        while (lb < ub) {
            let mid = Math.floor((lb + ub) / 2);
            let candidate = this.chunks[mid];
            let cmp = this.cmpRange(candidate, row);
            if (cmp === 0) {
                chunk = candidate;
                this.lastChunk = mid;
                break;
            } else if (cmp > 0) {
                lb = mid + 1;
            } else {
                ub = mid;
            }
        }
        return chunk;
    }

    /// Format a value
    public fmtValue(row: number, col: number): string | null {
        // Get the chunk
        let chunk = this.findChunk(row);
        if (!chunk) {
            return null;
        }

        // Column out of bounds?
        let columns = chunk.getColumnsList();
        if (col > columns.length) {
            return null;
        }

        // SQL NULL?
        let column = columns[col];
        let nullMask = column.getNullMaskList();
        if (col <= nullMask.length && nullMask[col]) {
            return 'NULL';
        }

        // Retrieve the corresponding column
        switch (column.getTypeId()) {
            case proto.engine.RawTypeID.RAW_BIGINT:
                return column.getRowsI64List()[row].toString();
            case proto.engine.RawTypeID.RAW_BOOLEAN:
                return column.getRowsI32List()[row].toString();
            case proto.engine.RawTypeID.RAW_DOUBLE:
                return column.getRowsF64List()[row].toString();
            case proto.engine.RawTypeID.RAW_FLOAT:
                return column.getRowsF32List()[row].toString();
            case proto.engine.RawTypeID.RAW_HASH:
                return column.getRowsU64List()[row].toString();
            case proto.engine.RawTypeID.RAW_INTEGER:
                return column.getRowsI64List()[row].toString();
            case proto.engine.RawTypeID.RAW_POINTER:
                return column.getRowsU64List()[row].toString();
            case proto.engine.RawTypeID.RAW_SMALLINT:
                return column.getRowsI32List()[row].toString();
            case proto.engine.RawTypeID.RAW_TINYINT:
                return column.getRowsI32List()[row].toString();
            case proto.engine.RawTypeID.RAW_VARBINARY:
                break;
            case proto.engine.RawTypeID.RAW_VARCHAR:
                return column.getRowsStrList()[row].toString();
        }

        return null;
    }
}
