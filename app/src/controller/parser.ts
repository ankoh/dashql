import { DashQLCore, Plan } from '@dashql/core';
import dashql_core_wasm from '@dashql/core/dist/dashql_core.wasm';

export class ParserController {
    parse: (input: string) => Plan = () => new Plan();

    async init() {
        const core = await DashQLCore.create(dashql_core_wasm);
        this.parse = core.parse.bind(core);
    }
}
