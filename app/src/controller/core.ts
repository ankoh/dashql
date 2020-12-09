import * as core from '@dashql/core';
import { DashQLCore, DashQLCoreRuntime } from '@dashql/core';
import dashql_core_wasm from '@dashql/core/dist/dashql_core.wasm';

const CORE_RUNTIME: DashQLCoreRuntime = {
    dashql_pong() { console.log("le pong"); return 21; },
    dashql_blob_stream_underflow: () => { return 0; }
}

export class CoreController {
    /// The runtime
    _runtime: DashQLCoreRuntime;
    /// The WebAssembly module
    _module: DashQLCore | null;
    /// The previous program
    _program: core.model.Program | null;

    constructor() {
        this._runtime = CORE_RUNTIME;
        this._module = null;
        this._program = null;
    }

    /// Init the WebAssembly module
    async init() {
        this._module = await DashQLCore.create(this._runtime, dashql_core_wasm);
    }

    /// Parse a program
    parseProgram(input: string): core.model.Program {
        this._program = this._module!.parseProgram(input);
        return this._program!;
    }

    /// Plan the last program
    planProgram(): core.model.Plan | null {
        if (this._program == null) {
            return null;
        }
        const plan_buffer = this._module!.planProgram();
        return new core.model.Plan(this._program, plan_buffer);
    }
}
