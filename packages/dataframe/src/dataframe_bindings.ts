// Copyright (c) 2020 The DashQL Authors

import { DataframeModule } from './dataframe_module';
import { webdb as proto } from '@dashql/proto';
import { flatbuffers } from 'flatbuffers';
import { Logger } from './log';

/// Decode a string
function decodeString(buffer: Uint8Array): string {
    var result = '';
    for (var i = 0; i < buffer.length; i++) {
        result += String.fromCharCode(buffer[i]);
    }
    return result;
}

/// Copy a flatbuffer
function copyFlatbuffer(buffer: Uint8Array): flatbuffers.ByteBuffer {
    var copy = new Uint8Array(new ArrayBuffer(buffer.byteLength));
    copy.set(buffer);
    return new flatbuffers.ByteBuffer(copy);
}

/// The proxy for either the browser- order node-based Dataframe API
export abstract class DataframeBindings {
    /// The logger
    private _logger: Logger;
    /// The instance
    private _instance: DataframeModule | null = null;
    /// The loading promise
    private _openPromise: Promise<void> | null = null;
    /// The resolver for the open promise (called by onRuntimeInitialized)
    private _openPromiseResolver: () => void = () => {};

    constructor(logger: Logger) {
        this._logger = logger;
    }

    /// Get the logger
    public get logger() {
        return this._logger;
    }
    /// Get the instance
    public get instance() {
        return this._instance;
    }

    /// Instantiate the module
    protected abstract instantiate(moduleOverrides: Partial<DataframeModule>): Promise<DataframeModule>;

    /// Open the database
    public async open() {
        // Already opened?
        if (this._instance != null) {
            return;
        }
        // Open in progress?
        if (this._openPromise != null) {
            await this._openPromise;
        }

        // Create a promise that we can await
        this._openPromise = new Promise(resolve => {
            this._openPromiseResolver = resolve;
        });

        // Initialize dataframe
        this._instance = await this.instantiate({
            print: console.log.bind(console),
            printErr: console.log.bind(console),
            onRuntimeInitialized: this._openPromiseResolver,
        });

        // Wait for onRuntimeInitialized
        await this._openPromise;
        this._openPromise = null;
    }

    // Call a core function with packed response buffer
    public callSRet(funcName: string, argTypes: Array<Emscripten.JSType>, args: Array<any>): [number, number, number] {
        // Save the stack
        let instance = this._instance!;
        let stackPointer = instance.stackSave();

        // Allocate the packed response buffer
        let response = instance.stackAlloc(3 * 8);
        argTypes.unshift('number');
        args.unshift(response);

        // Do the call
        instance.ccall(funcName, null, argTypes, args);

        // Read the response
        // XXX: wasm64 will break here.
        let status = instance.HEAPU32[(response >> 2) + 0];
        let data = instance.HEAPU32[(response >> 2) + 2];
        let dataSize = instance.HEAPU32[(response >> 2) + 4];

        // Restore the stack
        instance.stackRestore(stackPointer);
        return [status, data, dataSize];
    }

    public async helloWorld() {
        let instance = this.instance!;
        let dataframe = instance.ccall('dashql_dataframe', 'number', [], []);
        let [s, d, n] = this.callSRet('dashql_dataframe_get_module', ['number'], [dataframe]);
        let mem = instance.HEAPU8.subarray(d, d + n);
        if (s !== proto.StatusCode.SUCCESS) {
            throw new Error(decodeString(mem));
        }
        const { exports } = (await WebAssembly.instantiate(mem, {})).instance;
        console.log('foo', (exports.adder as any)(1337, 42));
    }
}
