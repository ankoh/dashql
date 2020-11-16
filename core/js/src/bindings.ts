// Copyright (c) 2020 The DashQL Authors

import { DashQLCoreModule } from './wasm/dashql_core_module';
import { flatbuffers } from 'flatbuffers';
import * as proto from './proto';
import { Module } from  './parser'

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
        let dataPtr = instance.HEAPU32[(response >> 2) + 0];
        let dataSize = instance.HEAPU32[(response >> 2) + 2];
        let dataOffset = instance.HEAPU32[(response >> 2) + 4];

        // Restore the stack
        instance.stackRestore(stackPointer);
        return [dataPtr, dataSize, dataOffset];
    }

    /// Parse a string and return a flatbuffer
    public parse(text: string): Module {
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
        let [ptr, size, ofs] = this.callSRet('dashql_parse', ['number'], [textMem]);
        let mem = instance.HEAPU8.subarray(ptr + ofs, ptr + ofs + size);
        let program = new ModuleBuffer(mem);
        instance.ccall('dashql_core_free', null, ['number'], [ptr]);

        /// Clear the utf8 string buffer
        instance.stackRestore(stackPointer);
        return new Module(textUTF8, program);
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

/// A flatbuffer containing a DashQL program
export class ModuleBuffer extends FlatBuffer<proto.syntax.Module> {
    public getRoot(buffer: flatbuffers.ByteBuffer) {
        return proto.syntax.Module.getRootAsModule(buffer);
    }
}
