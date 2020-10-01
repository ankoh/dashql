import * as proto from '@dashql/duckdb-proto';
import { flatbuffers } from 'flatbuffers';

export abstract class WebAPIBuffer<BufferType> {
    /// The buffer
    protected buffer: flatbuffers.ByteBuffer;
    /// The root
    protected root: BufferType;

    /// Constructor
    constructor(buffer: Uint8Array) {
        this.buffer = new flatbuffers.ByteBuffer(buffer);
        this.root = this.init(this.buffer);
    }

    /// Initialize the buffer
    protected abstract init(buffer: flatbuffers.ByteBuffer): BufferType;
    /// Get the object
    public get(): BufferType { return this.root; }
};

export class QueryResultBuffer extends WebAPIBuffer<proto.query_result.QueryResult> {
    public init(buffer: flatbuffers.ByteBuffer) {
        return proto.query_result.QueryResult.getRootAsQueryResult(buffer);
    }
}

export class QueryResultChunk extends WebAPIBuffer<proto.query_result.QueryResultChunk> {
    public init(buffer: flatbuffers.ByteBuffer) {
        return proto.query_result.QueryResultChunk.getRootAsQueryResultChunk(buffer);
    }
}
