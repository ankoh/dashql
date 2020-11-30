import * as core from '@dashql/core';
import { DashQLCore } from '@dashql/core';
import dashql_core_wasm from '@dashql/core/dist/dashql_core.wasm';

export class CoreController {
    /// The WebAssembly module
    _module: DashQLCore | null;
    /// The previous program
    _program: core.parser.Program | null;

    constructor() {
        this._module = null;
        this._program = null;
    }

    /// Init the WebAssembly module
    async init() {
        this._module = await DashQLCore.create(dashql_core_wasm);
    }

    /// Parse a program
    parseProgram(input: string): core.parser.Program {
        this._program = this._module!.parseProgram(input);
        return this._program!;
    }

    /// Plan the last program
    planProgram(): core.Plan | null {
        if (this._program == null) {
            return null;
        }
        const plan_buffer = this._module!.planProgram();
        return new core.Plan(this._program, plan_buffer);
    }
}
