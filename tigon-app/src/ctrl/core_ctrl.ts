import * as proto from 'tigon-proto';

// Real devs don't need types. ¯\_(ツ)_/¯
declare function TigonCore(args: any): any;

// IMPORTANT:
// ALL methods that transitively depend on the core MUST be asynchronous.
// This will be crucial if we ever want to move the core to a web worker.

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
                },
                postRun: function() {
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

    // Call a core function with packed response buffer
    protected callSRet(funcName: string, argTypes: Array<string>, args: Array<any>): [number, number, number, number] {
        // Save the stack
        var stackPointer = this.core.stackSave();

        // Allocate the packed response buffer
        var response = this.core.allocate(4 * 8, 'i8', this.core.ALLOC_STACK);
        argTypes.unshift('number');
        args.unshift(response);

        // Do the call
        this.core.ccall(funcName, 'void', argTypes, args);

        // Read the response
        // XXX: wasm64 will break here.
        let status = this.core.HEAPU32[(response >> 2) + 0];
        let error = this.core.HEAPU32[(response >> 2) + 2];
        let data = this.core.HEAPU32[(response >> 2) + 4];
        let dataSize = this.core.HEAPU32[(response >> 2) + 6];

        // Restore the stack
        this.core.stackRestore(stackPointer);
        return [status, error, data, dataSize];
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

    // Copy a flatbuffer
    public async copyFlatBuffer(session: number, buffer: flatbuffers.ByteBuffer): Promise<[number, number]> {
        return this.copyBuffer(session, buffer.bytes().subarray(buffer.position()));
    }

    // Copy a buffer
    public async copyBuffer(session: number, buffer: Uint8Array): Promise<[number, number]> {
        var ptr = this.core.allocate(buffer.length, 'i8', this.core.ALLOC_NORMAL); 
        let mem = this.core.HEAPU8.subarray(ptr, ptr + buffer.length);
        mem.set(buffer);
        this.core.ccall('tigon_register_buffer', 'void', ['number', 'number', 'number'], [session, ptr, buffer.length]);
        return [ptr, buffer.length];
    }

    // Parse TQL
    public async parseTQL(session: number, text: string): Promise<proto.tql.Module> {
        await this.waitUntilReady();
        let [status, error, data, dataSize] = this.callSRet('tigon_parse_tql', ['number', 'string'], [session, text]);
        if (status !== proto.web_api.StatusCode.SUCCESS) {
            return Promise.reject(new Error(""));
        }
        let mem = this.core.HEAPU8.subarray(data, data + dataSize);
        let msg = proto.tql.Module.deserializeBinary(mem);
        this.core.ccall('tigon_release_buffer', 'void', ['number', 'number'], [session, data]);
        return msg;
    }

    // Run a query
    public async runQuery(session: number, text: string): Promise<proto.duckdb.QueryResult> {
        await this.waitUntilReady();
        let [status, error, data, dataSize] = this.callSRet('tigon_run_query', ['number', 'string'], [session, text]);
        if (status !== proto.web_api.StatusCode.SUCCESS) {
            return Promise.reject(new Error(""));
        }
        let mem = this.core.HEAPU8.subarray(data, data + dataSize);
        let msg = proto.duckdb.QueryResult.deserializeBinary(mem);
        this.core.ccall('tigon_release_buffer', 'void', ['number', 'number'], [session, data]);
        return msg;
    }

    // Plan a query
    public async planQuery(session: number, text: string): Promise<proto.duckdb.QueryPlan> {
        await this.waitUntilReady();
        let [status, error, data, dataSize] = this.callSRet('tigon_plan_query', ['number', 'string'], [session, text]);
        if (status !== proto.web_api.StatusCode.SUCCESS) {
            return Promise.reject(new Error(""));
        }
        let mem = this.core.HEAPU8.subarray(data, data + dataSize);
        let msg = proto.duckdb.QueryPlan.deserializeBinary(mem);
        this.core.ccall('tigon_release_buffer', 'void', ['number', 'number'], [session, data]);
        return msg;
    }
};
