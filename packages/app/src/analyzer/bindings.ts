// Copyright (c) 2020 The DashQL Authors

import { DashQLAnalyzerModule } from './analyzer_wasm_module';
import { EditOperationVariant, packProgramEdit } from '../edit';
import { Plan, Program, ProgramInstance, InputValue } from '../model';
import * as Immutable from 'immutable';
import * as utils from '../utils';
import * as proto from '@dashql/proto';
import * as flatbuffers from 'flatbuffers';

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface AnalyzerRuntime {}

/** The proxy for either the browser- order node-based DashQLAnalyzer API */
export abstract class AnalyzerBindings {
    /** The instance */
    private _instance: DashQLAnalyzerModule | null = null;
    /** The loading promise */
    private _open_promise: Promise<void> | null = null;
    /** The resolver for the open promise (called by onRuntimeInitialized) */
    private _open_promise_resolver: () => void = () => {};

    /** The program */
    protected _program: Program | null = null;
    /** The program instance */
    protected _programInstance: ProgramInstance | null = null;

    /** Instantiate the module */
    protected abstract instantiate(moduleOverrides: Partial<DashQLAnalyzerModule>): Promise<DashQLAnalyzerModule>;

    /** Decode a string */
    public readString(begin: number, length: number): string {
        return utils.decodeText(this._instance!.HEAPU8.subarray(begin, begin + length));
    }

    /** Init the module */
    public async init(): Promise<void> {
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
        const instance = this._instance!;
        const stackPointer = instance.stackSave();

        // Allocate the packed response buffer
        const response = instance.stackAlloc(3 * 8);
        argTypes.unshift('number');
        args.unshift(response);

        // Do the call
        instance.ccall(funcName, null, argTypes, args);

        // Read the response
        const status = instance.HEAPF64[(response >> 3) + 0];
        const data = instance.HEAPF64[(response >> 3) + 1];
        const dataSize = instance.HEAPF64[(response >> 3) + 2];

        // Restore the stack
        instance.stackRestore(stackPointer);
        return [status, data, dataSize];
    }

    /** Reset the analyzer */
    public reset(): void {
        const instance = this._instance!;
        return instance.ccall('dashql_analyzer_reset', null, [], []);
    }

    /** Copy a flatbuffer */
    protected copyFlatbuffer(buffer: Uint8Array): flatbuffers.ByteBuffer {
        const copy = new Uint8Array(new ArrayBuffer(buffer.byteLength));
        copy.set(buffer);
        return new flatbuffers.ByteBuffer(copy);
    }

    /** Parse a string and return a flatbuffer */
    public parseProgram(text: string): Program {
        const instance = this._instance!;
        const stackPointer = instance.stackSave();

        // Encode the utf8 string and append 2 zero bytes for flex
        const encoder = new TextEncoder();
        const textUTF8 = encoder.encode(text);
        const textMem = instance.stackAlloc(textUTF8.length + 2);
        instance.HEAPU8.set(textUTF8, textMem);
        instance.HEAPU8[textMem + textUTF8.length] = 0;
        instance.HEAPU8[textMem + textUTF8.length + 1] = 0;

        // Call the parse function
        const [ptr, ofs, size] = this.callSRet('dashql_analyzer_parse_program', ['number'], [textMem]);
        const mem = this.copyFlatbuffer(instance.HEAPU8.subarray(ptr + ofs, ptr + ofs + size));
        const program = proto.syntax.Program.getRootAsProgram(mem);
        instance.ccall('dashql_clear_response', null, [], []);

        // Clear the utf8 string buffer
        instance.stackRestore(stackPointer);

        // Wrap the program
        this._program = new Program(text, textUTF8, program);
        return this._program;
    }

    /** Instantiate program */
    public instantiateProgram(params: Immutable.List<InputValue> = Immutable.List()): ProgramInstance | null {
        if (!this._instance || !this._program) return null;

        const builder = new flatbuffers.Builder();
        const inputOfs: flatbuffers.Offset[] = params
            .map(param => {
                proto.analyzer.InputValue.startInputValue(builder);
                proto.analyzer.InputValue.addStatementId(builder, param.statement);
                // XXX add value
                return proto.analyzer.InputValue.endInputValue(builder);
            })
            .toArray();
        const inputVectorOfs = proto.analyzer.ProgramInstantiation.createInputValuesVector(builder, inputOfs);
        const args = proto.analyzer.ProgramInstantiation.createProgramInstantiation(builder, inputVectorOfs);
        builder.finish(args);

        // Copy the arguments into the wasm module
        const argsBuffer = builder.dataBuffer();
        const argsMem = argsBuffer.bytes().subarray(argsBuffer.position());
        const argsPtr = this._instance.stackAlloc(argsMem.length);
        this._instance.HEAPU8.set(argsMem, argsPtr);

        // Call the analyzer function
        const [status, ofs, size] = this.callSRet('dashql_analyzer_instantiate_program', ['number'], [argsPtr]);
        if (status !== utils.StatusCode.SUCCESS) {
            throw new Error(this.readString(ofs, size));
        }
        const mem = this.copyFlatbuffer(this._instance.HEAPU8.subarray(ofs, ofs + size));
        const annotations = proto.analyzer.ProgramAnnotations.getRootAsProgramAnnotations(mem);
        this._instance.ccall('dashql_clear_response', null, [], []);

        // Wrap the program instance
        this._programInstance = new ProgramInstance(this._program, params, annotations);
        return this._programInstance;
    }

    /** Plan a program */
    public planProgram(): Plan | null {
        if (!this._instance || !this._programInstance) return null;

        // Call the analyzer function
        const [status, ofs, size] = this.callSRet('dashql_analyzer_plan_program', [], []);
        if (status !== utils.StatusCode.SUCCESS) {
            throw new Error(this.readString(ofs, size));
        }
        const mem = this.copyFlatbuffer(this._instance.HEAPU8.subarray(ofs, ofs + size));
        const plan = proto.analyzer.Plan.getRootAsPlan(mem);
        this._instance.ccall('dashql_clear_response', null, [], []);

        // Wrap the plan
        return new Plan(this._programInstance, plan);
    }

    /** Edit a program */
    public editProgram(edits: EditOperationVariant[]): ProgramInstance | null {
        if (!this._instance || !this._programInstance) return null;
        const input = this._programInstance.inputValues;

        // Pack the edits
        const builder = new flatbuffers.Builder();
        const editOfs = packProgramEdit(builder, edits);
        builder.finish(editOfs);
        const editBuffer = builder.dataBuffer();
        const editMem = editBuffer.bytes().subarray(editBuffer.position());
        const editPtr = this._instance.stackAlloc(editMem.length);
        this._instance.HEAPU8.set(editMem, editPtr);

        // Call the analyzer function
        const [status, ofs, size] = this.callSRet('dashql_analyzer_edit_program', ['number'], [editPtr]);
        if (status !== utils.StatusCode.SUCCESS) {
            throw new Error(this.readString(ofs, size));
        }
        const mem = this.copyFlatbuffer(this._instance.HEAPU8.subarray(ofs, ofs + size));
        const replacement = proto.analyzer.ProgramReplacement.getRootAsProgramReplacement(mem);
        this._instance.ccall('dashql_clear_response', null, [], []);

        // Replace the program instance
        const text = replacement.programText();
        const textUTF8 = replacement.programText(flatbuffers.Encoding.UTF8_BYTES);
        this._program = new Program(text!, textUTF8 as Uint8Array, replacement.program()!);
        this._programInstance = new ProgramInstance(this._program, input, replacement.annotations()!);

        return this._programInstance;
    }

    /** Update an task status */
    public updateTaskStatus(
        task_class: proto.task.TaskClass,
        task_id: number,
        task_status: proto.task.TaskStatusCode,
    ): void {
        if (!this._instance || !this._programInstance) return;
        this._instance.ccall(
            'dashql_analyzer_update_task_status',
            null,
            ['number', 'number', 'number'],
            [task_class as number, task_id, task_status as number],
        );
    }

    /** Free memory */
    public free(ptr: number, _size: number): void {
        if (!this._instance) return;
        this._instance._free(ptr);
    }
}
