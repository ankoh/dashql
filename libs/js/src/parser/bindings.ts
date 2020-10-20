// Copyright (c) 2020 The DashQL Authors

import { DashQLParserModule } from './dashql_parser_module';
import { flatbuffers } from 'flatbuffers';
import * as proto from '../proto';

/// The proxy for either the browser- order node-based DashQLParser API
export abstract class DashQLParserBindings {
    /// The instance
    private _instance: DashQLParserModule | null = null;
    /// The loading promise
    private _openPromise: Promise<void> | null = null;
    /// The resolver for the open promise (called by onRuntimeInitialized)
    private _openPromiseResolver: () => void = () => { };

    /// Instantiate the module
    protected abstract instantiate(moduleOverrides: Partial<DashQLParserModule>): Promise<DashQLParserModule>;

    /// Init the parser
    public async init() {
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

        // Initialize duckdb
        this._instance = await this.instantiate({
            print: console.log.bind(console),
            printErr: console.log.bind(console),
            onRuntimeInitialized: this._openPromiseResolver,
        });

        // Wait for onRuntimeInitialized
        await this._openPromise;
        this._openPromise = null;
    }

    /// Get the instance
    protected async getInstance(): Promise<DashQLParserModule> {
        if (this._instance != null)
            return this._instance;
        if (this._openPromise != null) {
            await this._openPromise;
            if (this._instance == null)
                throw new Error('instance initialization failed');
            return this._instance;
        }
        throw new Error('instance not initialized');
    }

    // Call a core function with packed response buffer
    protected async callSRet(
        funcName: string,
        argTypes: Array<Emscripten.JSType>,
        args: Array<any>,
    ): Promise<[number, number, number]> {
        // Save the stack
        let instance = await this.getInstance();
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
    public async parse(text: string): Promise<ProgramBuffer> {
        let instance = await this.getInstance();
        let [ptr, size, ofs] = await this.callSRet('dashql_parse', ['string'], [text]);
        let mem = instance.HEAPU8.subarray(ptr + ofs, ptr + ofs + size);
        let program = new ProgramBuffer(mem);
        instance.ccall('dashql_parser_free', null, ['number'], [ptr]);
        return program;
    }
};

/// An owning flatbuffer
export abstract class FlatBuffer<Proto> {
    /// The buffer
    protected _buffer: flatbuffers.ByteBuffer;
    /// The root
    protected _root: Proto;

    /// Constructor
    constructor(buffer: Uint8Array) {
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
export class ProgramBuffer extends FlatBuffer<proto.program.Program> {
    public getRoot(buffer: flatbuffers.ByteBuffer) {
        return proto.program.Program.getRootAsProgram(buffer);
    }
}

import Tag = proto.program.SectionTag;
import Entry = proto.program.SectionEntry;

/// A program sections reader.
/// We introduce this type from the beginning to migrate to a sections list more easily later.
export class ProgramSectionsReader {
    /// The sections
    _sections: proto.program.Sections;
    /// Constructor
    constructor(sections: proto.program.Sections) {
        this._sections = sections;
    }

    /// Functions to access an entry using the index.
    public getI64(i: number) { return this._sections.literalsI64(i); }
    public getF64(i: number) { return this._sections.literalsF64(i); }
    public getString(i: number) { return this._sections.literalsString(i); }
    public getParam(i: number) { return this._sections.parameterDeclarations(i); }
    public getFileLoad(i: number) { return this._sections.loadsFile(i); }
    public getHTTPLoad(i: number) { return this._sections.loadsHttp(i); }
    public getCSVExtract(i: number) { return this._sections.extractsCsv(i); }
    public getJSONExtract(i: number) { return this._sections.extractsJsonpath(i); }
    public getVizStatement(i: number) { return this._sections.vizStatements(i); }

    /// Assume an entry type.
    /// Returns null if the type differs.
    protected assume<T>(e: Entry, tag: Tag, sec: (i: number) => T | null): T | null {
        return (e.tag() == tag) ? sec(e.index()) : null;
    }
    public assumeI64(e: Entry) { this.assume(e, Tag.I64Literal, this._sections.literalsI64); }
    public assumeF64(e: Entry) { this.assume(e, Tag.F64Literal, this._sections.literalsF64); }
    public assumeString(e: Entry) { this.assume(e, Tag.StringLiteral, this._sections.literalsString); }
    public assumeParam(e: Entry) { this.assume(e, Tag.ParameterDeclaration, this._sections.parameterDeclarations); }
    public assumeFileLoad(e: Entry) { this.assume(e, Tag.FileLoad, this._sections.loadsFile); }
    public assumeHTTPLoad(e: Entry) { this.assume(e, Tag.HTTPLoad, this._sections.loadsHttp); }
    public assumeCSVExtract(e: Entry) { this.assume(e, Tag.CSVExtract, this._sections.extractsCsv); }
    public assumeJSONExtract(e: Entry) { this.assume(e, Tag.JSONPathExtract, this._sections.extractsJsonpath); }
    public assumeVizStatement(e: Entry) { this.assume(e, Tag.VizStatement, this._sections.vizStatements); }
};
