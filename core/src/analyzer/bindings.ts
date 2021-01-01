// Copyright (c) 2020 The DashQL Authors

import { DashQLAnalyzerModule } from './analyzer_wasm_module';
import { Plan, Program, ParameterValue } from '../model';
import { flatbuffers } from 'flatbuffers';
import * as Immutable from 'immutable';
import * as proto from '@dashql/proto';

export interface AnalyzerRuntime {}

/// The proxy for either the browser- order node-based DashQLAnalyzer API
export abstract class AnalyzerBindings {
    /// The instance
    private _instance: DashQLAnalyzerModule | null = null;
    /// The loading promise
    private _open_promise: Promise<void> | null = null;
    /// The resolver for the open promise (called by onRuntimeInitialized)
    private _open_promise_resolver: () => void = () => {};

    /// The program
    protected _program: Program | null = null;
    /// The program parameters
    protected _programParameters: Immutable.List<ParameterValue> = Immutable.List();

    /// Instantiate the module
    protected abstract instantiate(moduleOverrides: Partial<DashQLAnalyzerModule>): Promise<DashQLAnalyzerModule>;

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

    /// Reset the analyzer
    public reset() {
        let instance = this._instance!;
        return instance.ccall('dashql_analyzer_reset', null, [], []);
    }

    /// Copy a flatbuffer
    protected copyFlatbuffer(buffer: Uint8Array): flatbuffers.ByteBuffer {
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
        instance.HEAPU8[textMem + textUTF8.length] = 0;
        instance.HEAPU8[textMem + textUTF8.length + 1] = 0;

        /// Call the parse function
        let [ptr, ofs, size] = this.callSRet('dashql_analyzer_parse_program', ['number'], [textMem]);
        let mem = this.copyFlatbuffer(instance.HEAPU8.subarray(ptr + ofs, ptr + ofs + size));
        let program = proto.syntax.Program.getRoot(mem);
        instance.ccall('dashql_clear_response', null, [], []);

        /// Clear the utf8 string buffer
        instance.stackRestore(stackPointer);
        this._program = new Program(textUTF8, program);
        return this._program;
    }

    /// Instantiate program
    public instantiateProgram(params: Immutable.List<ParameterValue> = Immutable.List()): void {
        if (!this._program) return;
        this._programParameters = params;
        const instance = this._instance!;

        const builder = new flatbuffers.Builder();
        const paramOfs: flatbuffers.Offset[] = params.map(param => {
            proto.analyzer.ParameterValue.start(builder);
            proto.analyzer.ParameterValue.addStatementId(builder, param.statement);
            // XXX add value
            return proto.analyzer.ParameterValue.end(builder);
        }).toArray();
        const paramVectorOfs = proto.analyzer.ProgramInstantiation.createParametersVector(builder, paramOfs);
        const args = proto.analyzer.ProgramInstantiation.create(builder, paramVectorOfs);
        builder.finish(args);

        // Copy the arguments into the wasm module
        const argsBuffer = builder.dataBuffer();
        const argsMem = argsBuffer.bytes().subarray(argsBuffer.position());
        const argsPtr = instance.stackAlloc(argsMem.length);
        instance.HEAPU8.set(argsMem, argsPtr);

        // Call the planner function
        this.callSRet('dashql_analyzer_instantiate_program', ['number'], [argsPtr]);
        instance.ccall('dashql_clear_response', null, [], []);
    }

    /// Plan a program
    public planProgram(): Plan | null {
        if (!this._program) return null;
        const instance = this._instance!;

        // Call the planner function
        const [ptr, ofs, size] = this.callSRet('dashql_analyzer_plan_program', [], []);
        const mem = this.copyFlatbuffer(instance.HEAPU8.subarray(ptr + ofs, ptr + ofs + size));
        const plan = proto.analyzer.Plan.getRoot(mem);
        instance.ccall('dashql_clear_response', null, [], []);
        return new Plan(this._program, this._programParameters, plan);
    }

    /// Free memory
    public free(ptr: number, _size: number) {
        if (!this._instance) return;
        this._instance._free(ptr);
    }
}
