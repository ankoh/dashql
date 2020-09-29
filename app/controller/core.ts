import * as proto from '@dashql/proto';

declare let DashQLCore: any;

// IMPORTANT:
// ALL methods that transitively depend on the core MUST be asynchronous.
// This will be crucial if we ever want to move the core to a web worker.

// The core controller
export class CoreController {
    protected loading: Promise<void>;
    protected resolveLoading: () => void = () => {};
    protected core: any | null = null;

    constructor() {
        this.loading = new Promise(resolve => {
            this.resolveLoading = resolve;
        });
    }

    // Initialize the core
    public async init(): Promise<void> {
        const options: any = {
            print: console.log.bind(console),
            printErr: console.error.bind(console),
            onRuntimeInitialized: this.resolveLoading,
        };
        this.core = await DashQLCore(options);
        await this.loading;

        window.FS = this.core.FS;
    }

    // Wait until the core controller is ready
    public async waitUntilReady(): Promise<void> {
        return this.loading;
    }

    // Call a core function with packed response buffer
    protected callSRet(
        funcName: string,
        argTypes: Array<string>,
        args: Array<any>,
    ): [number, number, number, number] {
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
        let session = this.core.ccall(
            'dashql_create_session',
            'number',
            [],
            [],
        );
        return Promise.resolve(session);
    }

    // End a session
    public async endSession(session: number): Promise<void> {
        await this.waitUntilReady();
        this.core.ccall('dashql_end_session', 'void', ['number'], [session]);
        return Promise.resolve();
    }

    // Copy a buffer
    public async copyBuffer(
        session: number,
        buffer: Uint8Array,
    ): Promise<[number, number]> {
        var ptr = this.core.allocate(
            buffer.length,
            'i8',
            this.core.ALLOC_NORMAL,
        );
        let mem = this.core.HEAPU8.subarray(ptr, ptr + buffer.length);
        mem.set(buffer);
        this.core.ccall(
            'dashql_register_buffer',
            'void',
            ['number', 'number', 'number'],
            [session, ptr, buffer.length],
        );
        return [ptr, buffer.length];
    }

    // Parse TQL
    public async parseTQL(
        session: number,
        text: string,
    ): Promise<proto.tql.Module> {
        await this.waitUntilReady();
        let [status, error, data, dataSize] = this.callSRet(
            'dashql_parse_tql',
            ['number', 'string'],
            [session, text],
        );
        if (status !== proto.web_api.StatusCode.SUCCESS) {
            console.log(error);
            return Promise.reject(new Error(''));
        }
        let mem = this.core.HEAPU8.subarray(data, data + dataSize);
        let msg = proto.tql.Module.deserializeBinary(mem);
        this.core.ccall(
            'dashql_release_buffer',
            'void',
            ['number', 'number'],
            [session, data],
        );
        return msg;
    }

    // Run a query
    public async runQuery(
        session: number,
        text: string,
    ): Promise<proto.engine.QueryResult> {
        await this.waitUntilReady();
        let [status, error, data, dataSize] = this.callSRet(
            'dashql_run_query',
            ['number', 'string'],
            [session, text],
        );
        if (status !== proto.web_api.StatusCode.SUCCESS) {
            console.log(error);
            // return Promise.reject(new Error(''));
        }
        let mem = this.core.HEAPU8.subarray(data, data + dataSize);
        console.time('deserialize');
        let msg = proto.engine.QueryResult.deserializeBinary(mem);
        console.timeEnd('deserialize');
        this.core.ccall(
            'dashql_release_buffer',
            'void',
            ['number', 'number'],
            [session, data],
        );
        return msg;
    }

    // Plan a query
    public async planQuery(
        session: number,
        text: string,
    ): Promise<proto.engine.QueryPlan> {
        await this.waitUntilReady();
        let [status, error, data, dataSize] = this.callSRet(
            'dashql_plan_query',
            ['number', 'string'],
            [session, text],
        );
        if (status !== proto.web_api.StatusCode.SUCCESS) {
            console.log(error);
            return Promise.reject(new Error(''));
        }
        let mem = this.core.HEAPU8.subarray(data, data + dataSize);
        let msg = proto.engine.QueryPlan.deserializeBinary(mem);
        this.core.ccall(
            'dashql_release_buffer',
            'void',
            ['number', 'number'],
            [session, data],
        );
        return msg;
    }
}
