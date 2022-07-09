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
    heapU8: Uint8Array;
    heapU32: Uint32Array;

    constructor(instance: WebAssembly.Instance) {
        this.instance = instance;
        const parserExports = instance.exports;
        const parserMemory = parserExports['memory'] as unknown as WebAssembly.Memory;
        this.heapU8 = new Uint8Array(parserMemory.buffer);
        this.heapU32 = new Uint32Array(parserMemory.buffer);
        this.instanceExports = {
            dashql_new_result: parserExports['dashql_new_result'] as () => number,
            dashql_new_string: parserExports['dashql_new_string'] as (n: number) => number,
            dashql_delete_result: parserExports['dashql_delete_result'] as (n: number) => void,
            dashql_delete_string: parserExports['dashql_delete_string'] as (n: number) => void,
            dashql_parse: parserExports['dashql_parse'] as (result: number, text: number, textLength: number) => void,
        };
    }

    parse(text: string): ResultBuffer {
        const textEncoded = encoder.encode(text);
        const textPtr = this.instanceExports.dashql_new_string(textEncoded.length);
        const resultPtr = this.instanceExports.dashql_new_result();
        this.heapU8.subarray(textPtr, textPtr + textEncoded.length).set(textEncoded);
        this.instanceExports.dashql_parse(resultPtr, textPtr, textEncoded.length);
        this.instanceExports.dashql_delete_string(textPtr);
        const resultPtrU32 = resultPtr / 4;
        const statusCode = this.heapU32[resultPtrU32];
        const dataLength = this.heapU32[resultPtrU32 + 1];
        const dataPtr = this.heapU32[resultPtrU32 + 2];
        const dataArray = this.heapU8.subarray(dataPtr, dataPtr + dataLength);
        if (statusCode == 0) {
            return new ResultBuffer(this, resultPtr, dataArray);
        } else {
            const error = decoder.decode(dataArray);
            this.instanceExports.dashql_delete_result(resultPtr);
            throw new Error(error);
        }
    }
}
