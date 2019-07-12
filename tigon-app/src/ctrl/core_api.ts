import * as proto from '../proto';
import { flatbuffers } from 'flatbuffers';

// Mute typescript
declare global {
    var TigonWeb: any;
}

// A query result
export class QueryResult {
    protected core: any;
    protected bufferID: number;
    protected result: proto.QueryResult;

    constructor(core: any, bufferID: number, result: proto.tigon.webapi.QueryResult) {
        this.core = core;
        this.bufferID = bufferID;
        this.result = result;
    }

    /// Destroy a query result
    public destroy() {
        this.core.ccall('tigon_release_buffer', 'void', ['number'], [this.bufferID]);
    }
};

// A convenience wrapper around the core wasm module
export class CoreAPI {
    // The webassembly module
    protected core: any;

    // Init the core api
    public init() {
        this.core = TigonWeb({
            print: (function() {
                return function(text: any) {
                    console.log("[wasm] print");
                    console.log(text);
                };
            })(),
            printErr: function(text: any) {
                if (arguments.length > 1) text = Array.prototype.slice.call(arguments).join(' ');
                if (0) {
                    console.log("[wasm] printErr");
                    console.log(text);
                }
            },
        });
    }

    // Run a query
    public runQuery(text: string) {
        let bufferID = this.core.ccall('tigon_run_query', 'number', ['string'], [text]);
        let bufferPtr = this.core.ccall('tigon_get_buffer', 'number', ['number'], [bufferID]);
        let bufferSize = this.core.ccall('tigon_get_buffer_size', 'number', ['number'], [bufferID]);
        let data = new Uint8Array(TigonWeb.HEAPU8.buffer, bufferPtr, bufferSize);
        let byteBuffer = new flatbuffers.ByteBuffer(data);
        let result = proto.QueryResult.getRootAsQueryResult(byteBuffer);
        return new QueryResult(this.core, bufferID, result);
    }
};
