// Copyright (c) 2020 The DashQL Authors

import { DashQLCoreModule } from './core_wasm_module';
import { Plan, Program } from  '../model';
import { flatbuffers } from "flatbuffers";
import * as proto from "@dashql/proto";

///
/// dashql_blobstream_underflow(blob: number, buffer_ofs, buffer_size): uint32_t

/// The core runtime
export interface CoreWasmRuntime {
    dashql_pong(): number;
    dashql_blob_stream_underflow(): number;
}

/// Stubs for the DashQL core runtime
export const CORE_WASM_RUNTIME_STUBS: CoreWasmRuntime = {
    dashql_pong: () => { return 42; },
    dashql_blob_stream_underflow: () => { return 0; }
};

/// The proxy for either the browser- order node-based DashQLCore API
export abstract class CoreWasmBindings {
    /// The instance
    private _instance: DashQLCoreModule | null = null;
    /// The loading promise
    private _open_promise: Promise<void> | null = null;
    /// The resolver for the open promise (called by onRuntimeInitialized)
    private _open_promise_resolver: () => void = () => {};

    /// The program
    protected _program: Program | null = null;

    /// Instantiate the module
    protected abstract instantiate(moduleOverrides: Partial<DashQLCoreModule>): Promise<DashQLCoreModule>;

    /// Init the module
    public async init() {
        // Already opened?
        if (this._instance != null) {
            return;
        }
        // Open in progress?
        if (this._open_promise != null) {
            await this._open_promise;
        }

        // Create a promise that we can await
        this._open_promise = new Promise(resolve => {
            this._open_promise_resolver = resolve;
        });

        // Initialize duckdb
        this._instance = await this.instantiate({
            print: console.log.bind(console),
            printErr: console.log.bind(console),
            onRuntimeInitialized: this._open_promise_resolver,
        });

        // Wait for onRuntimeInitialized
        await this._open_promise;
        this._open_promise = null;
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

    /// Reset the session
    public resetSession() {
        let instance = this._instance!;
        return instance.ccall('dashql_reset_session', null, [], []);
    }

    /// Copy a flatbuffer
    public copyFlatbuffer(buffer: Uint8Array): flatbuffers.ByteBuffer {
        var copy = new Uint8Array(new ArrayBuffer(buffer.byteLength));
        copy.set(buffer);
        return new flatbuffers.ByteBuffer(copy);
    }

    /// Parse a string and return a flatbuffer
    public parseProgram(text: string): Program {
        let instance = this._instance!;
        let stackPointer = instance.stackSave();

        /// Encode the utf8 string and append 2 zero bytes for flex
        let encoder = new TextEncoder();
        let textUTF8 = encoder.encode(text);
        let textMem = instance.stackAlloc(textUTF8.length + 2);
        instance.HEAPU8.set(textUTF8, textMem);
        instance.HEAPU8[textUTF8.length] = 0;
        instance.HEAPU8[textUTF8.length + 1] = 0;

        /// Call the parse function
        let [ptr, ofs, size] = this.callSRet('dashql_parse_program', ['number'], [textMem]);
        let mem = this.copyFlatbuffer(instance.HEAPU8.subarray(ptr + ofs, ptr + ofs + size));
        let program = proto.syntax.Program.getRoot(mem);
        instance.ccall('dashql_clear_response', null, [], []);

        /// Clear the utf8 string buffer
        instance.stackRestore(stackPointer);
        this._program = new Program(textUTF8, program);
        return this._program;
    }

    /// Plan a program
    public planProgram(): Plan | null {
        if (!this._program) return null;
        let instance = this._instance!;
        let [ptr, ofs, size] = this.callSRet('dashql_plan_program', [], []);
        let mem = this.copyFlatbuffer(instance.HEAPU8.subarray(ptr + ofs, ptr + ofs + size));
        let plan = proto.session.Plan.getRoot(mem);
        instance.ccall('dashql_clear_response', null, [], []);
        return new Plan(this._program, plan);
    }

    /// Free memory
    public free(ptr: number, _size: number) {
        if (!this._instance) return;
        this._instance._free(ptr);
    }

    /// Ping the runtime
    public ping(): number {
        let instance = this._instance!;
        return instance.ccall('dashql_ping', 'number', [], []);
    }
};
