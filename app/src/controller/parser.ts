import { DashQLParser, ModuleBuffer } from '@dashql/parser';
import dashql_parser_wasm from '@dashql/parser/dist/dashql_parser.wasm';

export class ParserController {
    parse: (input: string) => ModuleBuffer = () => new ModuleBuffer(new Uint8Array());

    async init() {
        const parser = await DashQLParser.create(dashql_parser_wasm);
        this.parse = parser.parse.bind(parser);
    }
}
