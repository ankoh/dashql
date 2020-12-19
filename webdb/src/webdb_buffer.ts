// Copyright (c) 2020 The DashQL Authors

import { webdb as proto } from '@dashql/proto';
import { flatbuffers } from 'flatbuffers';

export abstract class WebDBBuffer<BufferType> {
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
    public get root(): BufferType { return this._root; }
};

export class QueryResultBuffer extends WebDBBuffer<proto.QueryResult> {
    public getRoot(buffer: flatbuffers.ByteBuffer) {
        return proto.QueryResult.getRoot(buffer);
    }
}

export class QueryResultChunkBuffer extends WebDBBuffer<proto.QueryResultChunk> {
    public getRoot(buffer: flatbuffers.ByteBuffer) {
        return proto.QueryResultChunk.getRoot(buffer);
    }
}

export class QueryPlanBuffer extends WebDBBuffer<proto.QueryPlan> {
    public getRoot(buffer: flatbuffers.ByteBuffer) {
        return proto.QueryPlan.getRoot(buffer);
    }
}
