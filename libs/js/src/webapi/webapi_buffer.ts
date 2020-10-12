// Copyright (c) 2020 The DashQL Authors

import * as proto from '../proto';
import { flatbuffers } from 'flatbuffers';

export abstract class WebAPIBuffer<BufferType> {
    /// The buffer
    protected _buffer: flatbuffers.ByteBuffer;
    /// The root
    protected _root: BufferType;

    /// Constructor
    constructor(buffer: Uint8Array) {
        var copy = new Uint8Array(new ArrayBuffer(buffer.byteLength));
        copy.set(buffer);
        this._buffer = new flatbuffers.ByteBuffer(copy);
        this._root = this.getRoot(this._buffer);
    }

    /// Initialize the buffer
    protected abstract getRoot(buffer: flatbuffers.ByteBuffer): BufferType;
    /// Get the object
    public get root(): BufferType { return this.root; }
};

export class QueryResultBuffer extends WebAPIBuffer<proto.query_result.QueryResult> {
    public getRoot(buffer: flatbuffers.ByteBuffer) {
        return proto.query_result.QueryResult.getRootAsQueryResult(buffer);
    }
}

export class QueryResultChunkBuffer extends WebAPIBuffer<proto.query_result.QueryResultChunk> {
    public getRoot(buffer: flatbuffers.ByteBuffer) {
        return proto.query_result.QueryResultChunk.getRootAsQueryResultChunk(buffer);
    }
}

export class QueryPlanBuffer extends WebAPIBuffer<proto.query_plan.QueryPlan> {
    public getRoot(buffer: flatbuffers.ByteBuffer) {
        return proto.query_plan.QueryPlan.getRootAsQueryPlan(buffer);
    }
}
