interface ParserAPI {
    dashql_new_result: () => number;
    dashql_new_string: (n: number) => number;
    dashql_delete_result: (ptr: number) => void;
    dashql_delete_string: (ptr: number) => void;
    dashql_parse: (result: number, text: number, textLength: number) => void;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class ResultBuffer {
    parser: Parser;
    resultPtr: number | null;
    data: Uint8Array;

    constructor(parser: Parser, resultPtr: number, data: Uint8Array) {
        this.parser = parser;
        this.resultPtr = resultPtr;
        this.data = data;
    }

    delete() {
        this.parser.instanceExports.dashql_delete_result(this.resultPtr);
        this.resultPtr = null;
    }

    getDataCopy(): Uint8Array {
        const copy = new Uint8Array(new ArrayBuffer(this.data.byteLength));
        copy.set(this.data);
        return copy;
    }

    getData(): Uint8Array {
        return this.data;
    }
}

export class Parser {
    instance: WebAssembly.Instance;
    instanceExports: ParserAPI;
    memory: WebAssembly.Memory;

    constructor(instance: WebAssembly.Instance) {
        this.instance = instance;
        const parserExports = instance.exports;
        const parserMemory = parserExports['memory'] as unknown as WebAssembly.Memory;
        this.memory = parserMemory;
        this.instanceExports = {
            dashql_new_result: parserExports['dashql_new_result'] as () => number,
            dashql_new_string: parserExports['dashql_new_string'] as (n: number) => number,
            dashql_delete_result: parserExports['dashql_delete_result'] as (n: number) => void,
            dashql_delete_string: parserExports['dashql_delete_string'] as (n: number) => void,
            dashql_parse: parserExports['dashql_parse'] as (result: number, text: number, textLength: number) => void,
        };
    }

    async parse(text: string): Promise<ResultBuffer> {
        try {
            const textEncoded = encoder.encode(text);
            const textPtr = this.instanceExports.dashql_new_string(textEncoded.length);
            const resultPtr = this.instanceExports.dashql_new_result();
            let heapU8 = new Uint8Array(this.memory.buffer);
            heapU8.subarray(textPtr, textPtr + textEncoded.length).set(textEncoded);
            this.instanceExports.dashql_parse(resultPtr, textPtr, textEncoded.length);
            this.instanceExports.dashql_delete_string(textPtr);
            heapU8 = new Uint8Array(this.memory.buffer);
            const resultPtrU32 = resultPtr / 4;
            const heapU32 = new Uint32Array(this.memory.buffer);
            const statusCode = heapU32[resultPtrU32];
            const dataLength = heapU32[resultPtrU32 + 1];
            const dataPtr = heapU32[resultPtrU32 + 2];
            const dataArray = heapU8.subarray(dataPtr, dataPtr + dataLength);
            if (statusCode == 0) {
                return new ResultBuffer(this, resultPtr, dataArray);
            } else {
                const error = decoder.decode(dataArray);
                this.instanceExports.dashql_delete_result(resultPtr);
                throw new Error(error);
            }
        } catch (e: any) {
            console.error(e);
            throw e;
        }
    }
}

const PARSER_WASM_IMPORT_STUBS = {
    wasi_snapshot_preview1: {
        proc_exit: (code: number) => console.error(`proc_exit(${code})`),
        environ_sizes_get: () => console.error(`environ_sizes_get()`),
        environ_get: (environ: number, buf: number) => console.error(`environ_get(${environ}, ${buf})`),
        fd_fdstat_get: (fd: number) => console.error(`fd_fdstat_get(${fd})`),
        fd_seek: (fd: number, offset: number, whence: number) => console.error(`fd_seek(${fd}, ${offset}, ${whence})`),
        fd_write: (fd: number, iovs: number) => console.error(`fd_write(${fd}, ${iovs})`),
        fd_read: (fd: number, iovs: number) => console.error(`fd_read(${fd}, ${iovs})`),
        fd_close: (fd: number) => console.error(`fd_close(${fd})`),
    },
};

export async function instantiateParser(mod: WebAssembly.Module): Promise<Parser> {
    const instance = await WebAssembly.instantiate(mod, PARSER_WASM_IMPORT_STUBS);
    const startFn = instance.exports['_start'] as () => number;
    startFn();
    return new Parser(instance);
}

export async function instantiateParserStreaming(url: PromiseLike<Response>): Promise<Parser> {
    const streaming = await WebAssembly.instantiateStreaming(url, PARSER_WASM_IMPORT_STUBS);
    const instance = streaming.instance;
    const startFn = instance.exports['_start'] as () => number;
    startFn();
    return new Parser(instance);
}
