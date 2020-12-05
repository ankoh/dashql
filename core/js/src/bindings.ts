// Copyright (c) 2020 The DashQL Authors

import { DashQLCoreModule } from './wasm/dashql_core_module';
import { Program } from  './parser';
import { flatbuffers } from 'flatbuffers';
import * as proto from './proto';

///
/// dashql_blobstream_underflow(blob: number, buffer_ofs, buffer_size): uint32_t

/// The core runtime
export interface DashQLCoreRuntime {
    dashql_pong(): number;
    dashql_blob_stream_underflow(): number;
}

/// Stubs for the DashQL core runtime
export const DASHQL_CORE_RUNTIME_STUBS: DashQLCoreRuntime = {
    dashql_pong: () => { console.log("pong"); return 42; },
    dashql_blob_stream_underflow: () => { return 0; }
}

/// The proxy for either the browser- order node-based DashQLCore API
export abstract class DashQLCoreBindings {
    /// The instance
    private _instance: DashQLCoreModule | null = null;
    /// The loading promise
    private _openPromise: Promise<void> | null = null;
    /// The resolver for the open promise (called by onRuntimeInitialized)
    private _openPromiseResolver: () => void = () => {};

    /// Instantiate the module
    protected abstract instantiate(moduleOverrides: Partial<DashQLCoreModule>): Promise<DashQLCoreModule>;

    /// Init the module
    public static async init(derived: DashQLCoreBindings) {
        // Already opened?
        if (derived._instance != null) {
            return;
        }
        // Open in progress?
        if (derived._openPromise != null) {
            await derived._openPromise;
        }

        // Create a promise that we can await
        derived._openPromise = new Promise(resolve => {
            derived._openPromiseResolver = resolve;
        });

        // Initialize duckdb
        derived._instance = await derived.instantiate({
            print: console.log.bind(console),
            printErr: console.log.bind(console),
            onRuntimeInitialized: derived._openPromiseResolver,
        });

        // Wait for onRuntimeInitialized
        await derived._openPromise;
        derived._openPromise = null;
    }

    // Call a core function with packed response buffer
    protected callSRet(
        funcName: string,
        argTypes: Array<Emscripten.JSType>,
        args: Array<any>,
    ): [number, number, number] {
        // Save the stack
        let instance = this._instance!;
        let stackPointer = instance.stackSave();

        // Allocate the packed response buffer
        let response = instance.allocate(3 * 8, 'i8', instance.ALLOC_STACK);
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

    /// Parse a string and return a flatbuffer
    public parseProgram(text: string): Program {
        let instance = this._instance!;
        let stackPointer = instance.stackSave();

        /// Encode the utf8 string and append 2 zero bytes for flex
        let encoder = new TextEncoder();
        let textUTF8 = encoder.encode(text);
        let textMem = instance.allocate(textUTF8.length + 2, 'i8', instance.ALLOC_STACK);
        instance.HEAPU8.set(textUTF8, textMem);
        instance.HEAPU8[textUTF8.length] = 0;
        instance.HEAPU8[textUTF8.length + 1] = 0;

        /// Call the parse function
        let [ptr, ofs, size] = this.callSRet('dashql_parse_program', ['number'], [textMem]);
        let mem = instance.HEAPU8.subarray(ptr + ofs, ptr + ofs + size);
        let buffer = new ProgramBuffer(mem);
        instance.ccall('dashql_clear_response', null, [], []);

        /// Clear the utf8 string buffer
        instance.stackRestore(stackPointer);
        return new Program(text, textUTF8, buffer);
    }

    /// Plan a program
    public planProgram(): FlatBuffer<proto.session.Plan> {
        let instance = this._instance!;
        let [ptr, ofs, size] = this.callSRet('dashql_plan_program', [], []);
        let mem = instance.HEAPU8.subarray(ptr + ofs, ptr + ofs + size);
        let buffer = new PlanBuffer(mem);
        instance.ccall('dashql_clear_response', null, [], []);
        return buffer;
    }

    /// Ping the runtime
    public ping(): number {
        let instance = this._instance!;
        return instance.ccall('dashql_ping', 'number', [], []);
    }

};

/// An owning flatbuffer
export abstract class FlatBuffer<Proto> {
    /// The buffer
    protected _buffer: flatbuffers.ByteBuffer;
    /// The root
    protected _root: Proto;

    /// Constructor
    constructor(buffer: Uint8Array = new Uint8Array(0)) {
        var copy = new Uint8Array(new ArrayBuffer(buffer.byteLength));
        copy.set(buffer);
        this._buffer = new flatbuffers.ByteBuffer(copy);
        this._root = this.getRoot(this._buffer);
    }

    /// Initialize the buffer
    protected abstract getRoot(buffer: flatbuffers.ByteBuffer): Proto;
    /// Get the object
    public get root(): Proto { return this._root; }
};

export class PlanBuffer extends FlatBuffer<proto.session.Plan> {
    public getRoot(buffer: flatbuffers.ByteBuffer) {
        return proto.session.Plan.getRoot(buffer);
    }
}

export class ProgramBuffer extends FlatBuffer<proto.syntax.Program> {
    public getRoot(buffer: flatbuffers.ByteBuffer) {
        return proto.syntax.Program.getRoot(buffer);
    }
}
