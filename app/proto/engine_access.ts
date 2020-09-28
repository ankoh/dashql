import * as proto from '@dashql/proto';
import { SQLTypeIDMap } from '@dashql/proto/src/proto/engine_pb';

export class ChunkedResult {
    protected chunks: proto.engine.QueryResultChunk[];
    protected columnCount: number;
    protected rowCount: number;
    protected columnNames: string[];
    protected sqlTypes: proto.engine.SQLType[];

    protected lastChunk: number;

    /// Constructor
    constructor(result: proto.engine.QueryResult) {
        this.chunks = result.getDataChunksList();
        this.columnCount = result.getColumnCount();
        this.rowCount = result.getRowCount();
        this.columnNames = result.getColumnNamesList();
        this.sqlTypes = result.getColumnSqlTypesList();
        this.lastChunk = 0;
    }

    /// Check a chunk
    protected compareRange(
        chunk: proto.engine.QueryResultChunk,
        row: number,
    ): number {
        const begin = chunk.getRowOffset();
        const end = chunk.getRowOffset() + chunk.getRowCount();

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
            this.compareRange(this.chunks[this.lastChunk], row) === 0
        );
    }

    /// Find a chunk
    public findChunk(row: number): proto.engine.QueryResultChunk | null {
        if (this.lastChunkContainsRow(row)) {
            return this.chunks[this.lastChunk];
        }

        let chunk: proto.engine.QueryResultChunk | null = null;
        let lower = 0;
        let upper = this.chunks.length;

        while (lower < upper) {
            const mid = Math.floor((lower + upper) / 2);
            const candidate = this.chunks[mid];
            const compare = this.compareRange(candidate, row);

            if (compare === 0) {
                chunk = candidate;
                this.lastChunk = mid;
                break;
            } else if (compare > 0) {
                lower = mid + 1;
            } else {
                upper = mid;
            }
        }

        return chunk;
    }

    public getColumnCount() {
        return this.columnCount;
    }

    public getColumnName(columnIndex: number) {
        return this.columnNames[columnIndex];
    }

    public getRowCount() {
        return this.rowCount;
    }

    public getColumn(
        columnIndex: number,
    ): (string | number | Date | null | undefined)[] {
        const result: (string | number | Date | null | undefined)[] = new Array(
            this.getRowCount(),
        );

        const chunks = this.chunks.sort(
            (a, b) => a.getRowOffset() - b.getRowOffset(),
        );

        const typeId = this.sqlTypes[columnIndex].getTypeId();

        for (const chunk of chunks) {
            const offset = chunk.getRowOffset();
            const count = chunk.getRowCount();

            for (let i = offset; i < offset + count; i++) {
                result[i] = this.getValueFromChunk(
                    columnIndex,
                    i,
                    typeId,
                    chunk,
                );
            }
        }

        return result;
    }

    public getValue(
        columnIndex: number,
        rowIndex: number,
    ): string | number | Date | null | undefined {
        // Get the chunk
        const chunk = this.findChunk(rowIndex);

        if (!chunk) {
            return undefined;
        }

        const typeId = this.sqlTypes[columnIndex].getTypeId();

        return this.getValueFromChunk(columnIndex, rowIndex, typeId, chunk);
    }

    public getValueFromChunk(
        columnIndex: number,
        rowIndex: number,
        typeId: SQLTypeIDMap[keyof SQLTypeIDMap],
        chunk: proto.engine.QueryResultChunk,
    ): string | number | Date | null | undefined {
        const columns = chunk.getColumnsList();
        const column = columns[columnIndex];
        const nullMask = column.getNullMaskList();

        const index = rowIndex - chunk.getRowOffset();

        if (nullMask[index]) {
            return null;
        }

        // Retrieve the corresponding column
        switch (typeId) {
            case proto.engine.SQLTypeID.SQL_INVALID:
                return undefined;
            case proto.engine.SQLTypeID.SQL_NULL:
                return null;
            case proto.engine.SQLTypeID.SQL_UNKNOWN:
                return undefined;
            case proto.engine.SQLTypeID.SQL_ANY:
                throw 'SQL_ANY format not implemented!';
            case proto.engine.SQLTypeID.SQL_BOOLEAN:
                return column.getRowsBoolList()[index];
            case proto.engine.SQLTypeID.SQL_TINYINT:
                return column.getRowsI32List()[index];
            case proto.engine.SQLTypeID.SQL_SMALLINT:
                return column.getRowsI32List()[index];
            case proto.engine.SQLTypeID.SQL_INTEGER:
                return column.getRowsI32List()[index];
            case proto.engine.SQLTypeID.SQL_BIGINT:
                return column.getRowsI64List()[index];
            case proto.engine.SQLTypeID.SQL_DATE:
                return new Date(column.getRowsI64List()[index] * 1000);
            case proto.engine.SQLTypeID.SQL_TIME:
                return new Date(column.getRowsI32List()[index]);
            case proto.engine.SQLTypeID.SQL_TIMESTAMP:
                return new Date(column.getRowsI64List()[index] * 1000);
            case proto.engine.SQLTypeID.SQL_FLOAT:
                return column.getRowsF32List()[index];
            case proto.engine.SQLTypeID.SQL_DOUBLE:
                return column.getRowsF64List()[index];
            case proto.engine.SQLTypeID.SQL_DECIMAL:
                throw 'SQL_DECIMAL format not implemented!';
            case proto.engine.SQLTypeID.SQL_CHAR:
                throw 'SQL_CHAR format not implemented!';
            case proto.engine.SQLTypeID.SQL_VARCHAR:
                return column.getRowsStrList()[index];
            case proto.engine.SQLTypeID.SQL_VARBINARY:
                throw 'SQL_VARBINARY format not implemented!';
            case proto.engine.SQLTypeID.SQL_BLOB:
                throw 'SQL_BLOB format not implemented!';
            case proto.engine.SQLTypeID.SQL_STRUCT:
                throw 'SQL_STRUCT format not implemented!';
            case proto.engine.SQLTypeID.SQL_LIST:
                throw 'SQL_LIST format not implemented!';
        }
    }

    /// Format a value
    public getStringValue(columnIndex: number, rowIndex: number): string {
        // Get the chunk
        const chunk = this.findChunk(rowIndex);

        if (!chunk) {
            return 'INVALID';
        }

        const columns = chunk.getColumnsList();
        const column = columns[columnIndex];
        const nullMask = column.getNullMaskList();

        const index = rowIndex - chunk.getRowOffset();

        if (nullMask[index]) {
            return 'NULL';
        }

        const typeId = this.sqlTypes[columnIndex].getTypeId();

        // Retrieve the corresponding column
        switch (typeId) {
            case proto.engine.SQLTypeID.SQL_INVALID:
                return 'INVALID';
            case proto.engine.SQLTypeID.SQL_NULL:
                return 'NULL';
            case proto.engine.SQLTypeID.SQL_UNKNOWN:
                return 'UNKNOWN';
            case proto.engine.SQLTypeID.SQL_ANY:
                throw 'SQL_ANY format not implemented!';
            case proto.engine.SQLTypeID.SQL_BOOLEAN:
                return column.getRowsBoolList()[index].toString();
            case proto.engine.SQLTypeID.SQL_TINYINT:
                return column.getRowsI32List()[index].toString();
            case proto.engine.SQLTypeID.SQL_SMALLINT:
                return column.getRowsI32List()[index].toString();
            case proto.engine.SQLTypeID.SQL_INTEGER:
                return column.getRowsI32List()[index].toString();
            case proto.engine.SQLTypeID.SQL_BIGINT:
                return column.getRowsI64List()[index].toString();
            case proto.engine.SQLTypeID.SQL_DATE: {
                const formatter = new Intl.DateTimeFormat(navigator.language, {
                    timeZone: 'UTC',
                    year: 'numeric',
                    month: 'numeric',
                    day: 'numeric',
                });

                const date = new Date(column.getRowsI64List()[index] * 1000);

                return formatter.format(date);
            }
            case proto.engine.SQLTypeID.SQL_TIME: {
                const formatter = new Intl.DateTimeFormat(navigator.language, {
                    timeZone: 'UTC',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false,
                });

                const date = new Date(column.getRowsI32List()[index]);

                return formatter.format(date);
            }
            case proto.engine.SQLTypeID.SQL_TIMESTAMP: {
                const formatter = new Intl.DateTimeFormat(navigator.language, {
                    timeZone: 'UTC',
                    year: 'numeric',
                    month: 'numeric',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false,
                });

                const date = new Date(column.getRowsI64List()[index] * 1000);

                return formatter.format(date);
            }
            case proto.engine.SQLTypeID.SQL_FLOAT:
                return column.getRowsF32List()[index].toString();
            case proto.engine.SQLTypeID.SQL_DOUBLE:
                return column.getRowsF64List()[index].toString();
            case proto.engine.SQLTypeID.SQL_DECIMAL:
                throw 'SQL_DECIMAL format not implemented!';
            case proto.engine.SQLTypeID.SQL_CHAR:
                throw 'SQL_CHAR format not implemented!';
            case proto.engine.SQLTypeID.SQL_VARCHAR:
                return column.getRowsStrList()[index];
            case proto.engine.SQLTypeID.SQL_VARBINARY:
                throw 'SQL_VARBINARY format not implemented!';
            case proto.engine.SQLTypeID.SQL_BLOB:
                throw 'SQL_BLOB format not implemented!';
            case proto.engine.SQLTypeID.SQL_STRUCT:
                throw 'SQL_STRUCT format not implemented!';
            case proto.engine.SQLTypeID.SQL_LIST:
                throw 'SQL_LIST format not implemented!';
        }
    }
}
