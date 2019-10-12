import * as proto from '../proto';
import { flatbuffers } from 'flatbuffers';

// Real devs don't need types. ¯\_(ツ)_/¯
declare function TigonCore(args: any): any;

// IMPORTANT:
// ALL methods that transitively depend on the core MUST be asynchronous.
// This will be crucial if we ever want to move the core to a web worker.

// A core result
export class CoreBuffer<ProtoBuffer> {
    protected core: any;
    protected session: number;
    protected bufferPtr: number;
    protected bufferReader: ProtoBuffer;

    // Constructor
    constructor(core: any, session: number, bufferPtr: number, bufferReader: ProtoBuffer) {
        this.core = core;
        this.session = session;
        this.bufferPtr = bufferPtr;
        this.bufferReader = bufferReader;
    }

    // Get the result
    public getBuffer(): ProtoBuffer {
        return this.bufferReader;
    }

    // Destroy a query result
    public destroy(): Promise<void> {
        this.core.ccall('tigon_release_buffer', 'void', ['number', 'number'], [this.session, this.bufferPtr]);
        return Promise.resolve();
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
            this.loadCore = TigonCore;
        }
    }

    // Initialize the core
    public init(): Promise<void> {
        this.coreLoading = new Promise<void>(resolve => {

            this.core = this.loadCore({
                print: function(text: any) {
                    console.log(text);
                },
                printErr: function(text: any) {
                    console.log(text);
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

    // Create a session 
    public async createSession(): Promise<number> {
        await this.waitUntilReady();
        let session = this.core.ccall('tigon_create_session', 'number', [], []);
        return Promise.resolve(session);
    }

    // End a session
    public async endSession(session: number): Promise<void> {
        await this.waitUntilReady();
        this.core.ccall('tigon_end_session', 'void', ['number'], [session]);
        return Promise.resolve();
    }

    // Run a query
    public async runQuery(session: number, text: string): Promise<CoreBuffer<proto.QueryResult>> {
        await this.waitUntilReady();
        this.core.ccall('tigon_run_query', 'void', ['number', 'string'], [session, text]);

        // Did the query fail?
        let status = this.core.ccall('tigon_get_response_status', 'number', ['number'], [session]);
        if (status !== proto.StatusCode.Success) {
            let error = this.core.ccall('tigon_get_response_error_message', 'string', ['number'], [session]);
            return Promise.reject(new Error(error));
        }

        // Get result buffer
        let bPtr = this.core.ccall('tigon_get_response_data', 'number', ['number'], [session]);
        let bSize = this.core.ccall('tigon_get_buffer_size', 'number', ['number'], [bPtr]);
        let u8B = new Uint8Array(this.core.HEAPU8.buffer, bPtr, bSize);
        let fB = new flatbuffers.ByteBuffer(u8B);
        let reader = proto.QueryResult.getRootAsQueryResult(fB);
        let result = new CoreBuffer<proto.QueryResult>(this.core, session, bPtr, reader);
        return Promise.resolve(result);
    }

    // Plan a query
    public async planQuery(session: number, text: string): Promise<CoreBuffer<proto.QueryPlan>> {
        await this.waitUntilReady();
        this.core.ccall('tigon_plan_query', 'void', ['number', 'string'], [session, text]);

        // Did the query fail?
        let status = this.core.ccall('tigon_get_response_status', 'number', ['number'], [session]);
        if (status !== proto.StatusCode.Success) {
            let error = this.core.ccall('tigon_get_response_error_message', 'string', ['number'], [session]);
            return Promise.reject(new Error(error));
        }

        // Get plan buffer
        let bPtr = this.core.ccall('tigon_get_response_data', 'number', ['number'], [session]);
        let bSize = this.core.ccall('tigon_get_buffer_size', 'number', ['number'], [bPtr]);
        let u8B = new Uint8Array(this.core.HEAPU8.buffer, bPtr, bSize);
        let fB = new flatbuffers.ByteBuffer(u8B);
        let reader = proto.QueryPlan.getRootAsQueryPlan(fB);
        let plan = new CoreBuffer<proto.QueryPlan>(this.core, session, bPtr, reader);
        return Promise.resolve(plan);
    }
};
