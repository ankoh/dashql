import * as proto from '../proto';
import { flatbuffers } from 'flatbuffers';

export abstract class WebAPIBuffer<BufferType> {
    /// The buffer
    protected buffer: flatbuffers.ByteBuffer;
    /// The root
    protected root: BufferType;

    /// Constructor
    constructor(buffer: Uint8Array) {
        var copy = new Uint8Array(new ArrayBuffer(buffer.byteLength));
        copy.set(buffer);
        this.buffer = new flatbuffers.ByteBuffer(copy);
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

export class QueryResultChunkBuffer extends WebAPIBuffer<proto.query_result.QueryResultChunk> {
    public init(buffer: flatbuffers.ByteBuffer) {
        return proto.query_result.QueryResultChunk.getRootAsQueryResultChunk(buffer);
    }
}

export class QueryPlanBuffer extends WebAPIBuffer<proto.query_plan.QueryPlan> {
    public init(buffer: flatbuffers.ByteBuffer) {
        return proto.query_plan.QueryPlan.getRootAsQueryPlan(buffer);
    }
}
