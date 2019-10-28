import * as proto from 'tigon-proto';
import { flatbuffers } from 'flatbuffers';

export abstract class CoreBuffer<ProtoBuffer> {
    protected core: any;
    protected session: number;
    protected data: number;
    protected dataSize: number;

    // Constructor
    constructor(core: any, session: number, data: number, dataSize: number) {
        this.core = core;
        this.session = session;
        this.data = data;
        this.dataSize = dataSize;
    }

    // Release the buffer
    public release(): Promise<void> {
        this.core.ccall('tigon_release_buffer', 'void', ['number', 'number'], [this.session, this.data]);
        return Promise.resolve();
    }

    // Get the reader
    abstract getReader(): ProtoBuffer;
};

export class QueryResultBuffer extends CoreBuffer<proto.web_api.QueryResult> {
    public getReader() {
        let u8B = new Uint8Array(this.core.HEAPU8.subarray(this.data, this.data + this.dataSize));
        let fB = new flatbuffers.ByteBuffer(u8B);
        return proto.web_api.QueryResult.getRootAsQueryResult(fB);
    }
}

export class QueryPlanBuffer extends CoreBuffer<proto.web_api.QueryPlan> {
    public getReader() {
        let u8B = new Uint8Array(this.core.HEAPU8.subarray(this.data, this.data + this.dataSize));
        let fB = new flatbuffers.ByteBuffer(u8B);
        return proto.web_api.QueryPlan.getRootAsQueryPlan(fB);
    }
}
