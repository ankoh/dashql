import * as proto from '../proto';
import { flatbuffers } from 'flatbuffers';

// Real devs don't need types. ¯\_(ツ)_/¯
declare function TigonWeb(args: any): any;

// A query result
export class QueryResult {
    protected core: any;
    protected bufferID: number;
    protected buffer: proto.QueryResult;

    // Constructor
    constructor(core: any, bufferID: number, result: proto.QueryResult) {
        this.core = core;
        this.bufferID = bufferID;
        this.buffer = result;
    }

    // Get the result
    public getBuffer(): proto.QueryResult {
        return this.buffer;
    }

    // Destroy a query result
    public destroy() {
        this.core.ccall('tigon_release_buffer', 'void', ['number'], [this.bufferID]);
    }
};

// The core controller
export class CoreController {
    // The function to load the core
    protected loadCore: any;
    // The core is loading
    protected coreLoading: Promise<void> | null = null;
    // The core module
    protected core: any | null = null;

    // Constructor
    constructor(loadCore: any | null = null) {
        if (loadCore != null) {
            this.loadCore = loadCore;
        } else {
            this.loadCore = TigonWeb;
        }
    }

    // Initialize the core
    public init(): Promise<void> {
        this.coreLoading = new Promise<void>(resolve => {
            this.core = this.loadCore({
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
                onRuntimeInitialized: function() {
                    resolve();
                },
            });
        });
        return this.coreLoading;
    }

    // Wait until the core controller is ready
    public async waitUntilReady(): Promise<void> {
        if (this.coreLoading != null) {
            return this.coreLoading;
        } else {
            return Promise.resolve();
        }
    }

    // Run a query
    public async runQuery(text: string): Promise<QueryResult> {
        await this.waitUntilReady();
        let bufferID = this.core.ccall('tigon_run_query', 'number', ['string'], [text]);
        let bufferPtr = this.core.ccall('tigon_get_buffer', 'number', ['number'], [bufferID]);
        let bufferSize = this.core.ccall('tigon_get_buffer_size', 'number', ['number'], [bufferID]);
        let data = new Uint8Array(this.core.HEAPU8.buffer, bufferPtr, bufferSize);
        let byteBuffer = new flatbuffers.ByteBuffer(data);
        let result = proto.QueryResult.getRootAsQueryResult(byteBuffer);
        return Promise.resolve(new QueryResult(this.core, bufferID, result));
    }
};
