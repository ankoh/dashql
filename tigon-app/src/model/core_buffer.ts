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

    // Get root as
    protected abstract getRoot(buffer: flatbuffers.ByteBuffer): ProtoBuffer;

    // Get the reader
    public getReader(): ProtoBuffer {
        let u8B = new Uint8Array(this.core.HEAPU8.subarray(this.data, this.data + this.dataSize));
        let fB = new flatbuffers.ByteBuffer(u8B);
        return this.getRoot(fB);
    }

    // Get the data
    public getData(): number { return this.data; }
};

export class TQLProgramBuffer extends CoreBuffer<proto.tql.TQLProgram> {
    public getRoot(buffer: flatbuffers.ByteBuffer) {
        return proto.tql.TQLProgram.getRootAsTQLProgram(buffer);
    }
}

export class QueryResultBuffer extends CoreBuffer<proto.duckdb.QueryResult> {
    public getRoot(buffer: flatbuffers.ByteBuffer) {
        return proto.duckdb.QueryResult.getRootAsQueryResult(buffer);
    }
}

export class QueryPlanBuffer extends CoreBuffer<proto.duckdb.QueryPlan> {
    public getRoot(buffer: flatbuffers.ByteBuffer) {
        return proto.duckdb.QueryPlan.getRootAsQueryPlan(buffer);
    }
}

export class FormattedTextBuffer extends CoreBuffer<proto.web_api.FormattedText> {
    public getRoot(buffer: flatbuffers.ByteBuffer) {
        return proto.web_api.FormattedText.getRootAsFormattedText(buffer);
    }
}
