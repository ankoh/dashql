import * as proto from '../proto/web_api_generated';
import * as ctrl from '../ctrl';

// A data column
export class Column {
    name: string;
    loadStringFunc: (index: number) => string;

    constructor(name: string, loadStringFunc: (index: number) => string) {
        this.name = name;
        this.loadStringFunc = loadStringFunc;
    }

    public getName(): string {
        return this.name;
    }

    public getRowAsString(index: number): string {
        return this.loadStringFunc(index);
    }
};

// The data source for the table
export class DataSource {
    columns: Array<Column>;
    rowCount: number;
    timestamp: number;

    constructor() {
        this.columns = new Array<Column>();
        this.rowCount = 0;
        this.timestamp = Date.now();
    }

    public destroy() {}

    public getColumn(index: number): Column {
        return this.columns[index];
    }

    public getColumnCount(): number {
        return this.columns.length;
    }

    public getRowCount(): number {
        return this.rowCount;
    }
};

export class InlineAnyRows extends DataSource {
    data: Array<any>;

    constructor(columns: Array<string>, data: Array<any>) {
        super();
        this.data = data;
        this.rowCount = data.length / columns.length;

        for (let column = 0; column < columns.length; ++column) {
            this.columns.push(
                new Column(columns[column], function (row: number): string {
                    return data[row * columns.length + column]
                })
            );
        }
    }
}

export class QueryResultDataSource extends DataSource {
    result: ctrl.CoreBuffer<proto.QueryResult>;
    chunks: Array<{
        offset: number,
        chunk: proto.QueryResultChunk,
    }>;
    columnData: Array<Array<DataView | null>>;

    // Constructor
    constructor(result: ctrl.CoreBuffer<proto.QueryResult>) {
        super();
        this.result = result;
        this.chunks = [];
        let resultBuffer = result.getBuffer();

        // Prepare column arrays
        let columnCount = resultBuffer.columnRawTypesLength();
        this.columnData = [];
        for (let i = 0; i < columnCount; ++i) {
            this.columnData.push([]);
        }

        // Write chunks
        let rows = 0;
        for (let i = 0; i < resultBuffer.dataChunksLength(); ++i) {
            let chunk = resultBuffer.dataChunks(i);
            if (chunk == null) {
                continue;
            }

            // Store chunk
            this.chunks.push({
                offset: rows,
                chunk: chunk
            });
            rows += chunk.columnsLength();

            // Store columns
            for (let j = 0; j < columnCount; ++j) {
                let column = chunk.columns(j);
                let rawType = resultBuffer.columnRawTypes(i);
                if (column == null || rawType == null) {
                    this.columnData[j].push(null);
                } else {
                    switch (rawType) {
                        case proto.RawTypeID.INVALID:
                            // TODO
                            break;
                        case proto.RawTypeID.BOOLEAN:
                        case proto.RawTypeID.TINYINT:
                        case proto.RawTypeID.SMALLINT:
                        case proto.RawTypeID.INTEGER:
                        case proto.RawTypeID.BIGINT:
                        case proto.RawTypeID.HASH:
                        case proto.RawTypeID.POINTER:
                        case proto.RawTypeID.FLOAT:
                        case proto.RawTypeID.DOUBLE: {
                            let buffer = column.fixedLengthDataArray();
                            if (buffer == null) {
                                this.columnData[j].push(null);
                            } else {
                                this.columnData[j].push(new DataView(buffer.buffer, buffer.byteOffset, buffer.length));
                            }
                            break;
                        }
                        case proto.RawTypeID.VARCHAR:
                            // Push indexed buffer
                            // TODO
                            break;
                        case proto.RawTypeID.VARBINARY:
                            // TODO
                            break;
                    }
                }
            }
        }

        // Create columns
        let self = this;
        for (let i = 0; i < columnCount; ++i) {
            this.columns.push(
                new Column(
                    resultBuffer.columnNames(i) || "",
                    function(row: number): string {
                        return self.getRowAsString(i, row);
                    }
                )
            );
        }
    }

    public destroy() {
        this.result.destroy();
    }

    // Find a chunk
    protected findChunk(row: number): number {
        let remaining = this.chunks.length;
        let iter = 0;
        while (remaining > 0) {
            let step = remaining / 2;
            if (this.chunks[iter + step].offset < row) {
                iter += step + 1;
                remaining -= step + 1;
            } else {
                remaining = step;
            }
        }
        return iter;
    }

    protected getRowAsString(column: number, row: number): string {
        // Get type
        let rawType = this.result.getBuffer().columnRawTypes(column);
        if (rawType == null) {
            return "";
        }

        // Get chunk id
        let chunkID = this.findChunk(row);
        if (chunkID >= this.columnData.length) {
            return "";
        }

        let data: DataView | null;

        // Access the data
        switch (rawType) {
            case proto.RawTypeID.INVALID:
                // TODO
                break;
            case proto.RawTypeID.BOOLEAN:
                data = this.columnData[column][chunkID];
                return data ? data.getInt8(row).toString() : "";
            case proto.RawTypeID.TINYINT:
                data = this.columnData[column][chunkID];
                return data ? data.getInt16(row).toString() : "";
            case proto.RawTypeID.SMALLINT:
                data = this.columnData[column][chunkID];
                return data ? data.getInt32(row).toString() : "";
            case proto.RawTypeID.INTEGER:
                data = this.columnData[column][chunkID];
                return data ? data.getInt32(row).toString() : "";
            case proto.RawTypeID.BIGINT:
                data = this.columnData[column][chunkID];
                return data ? data.getBigInt64(row).toString() : "";
            case proto.RawTypeID.HASH:
                data = this.columnData[column][chunkID];
                return data ? data.getBigUint64(row).toString() : "";
            case proto.RawTypeID.POINTER:
                data = this.columnData[column][chunkID];
                return data ? data.getBigUint64(row).toString() : "";
            case proto.RawTypeID.FLOAT:
                data = this.columnData[column][chunkID];
                return data ? data.getFloat32(row).toString() : "";
            case proto.RawTypeID.DOUBLE:
                data = this.columnData[column][chunkID];
                return data ? data.getFloat64(row).toString() : "";
            case proto.RawTypeID.VARCHAR:
                // TODO
                break;
            case proto.RawTypeID.VARBINARY:
                // TODO
                break;
        }
        return "";
    }
};
