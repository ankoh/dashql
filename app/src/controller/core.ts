import * as core from '@dashql/core';
import { DashQLCore } from '@dashql/core';
import dashql_core_wasm from '@dashql/core/dist/dashql_core.wasm';

export class CoreController {
    /// The WebAssembly module
    _module: DashQLCore | null;

    constructor() {
        this._module = null;
    }

    /// Init the WebAssembly module
    async init() {
        this._module = await DashQLCore.create(dashql_core_wasm);
    }

    /// Parse an input string
    parse(input: string): core.parser.Program {
        return this._module!.parse(input);
    }
}
