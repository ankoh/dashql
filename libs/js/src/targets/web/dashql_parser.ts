// Copyright (c) 2020 The DashQL Authors

import dashql_parser_wasm from '../../parser/dashql_parser_web.wasm';
import dashql_parser_init from '../../parser/dashql_parser_web.js';
import * as proto from '../../proto';

import { DashQLParserModule } from '../../parser/dashql_parser_module';
import { DashQLParserBindings, FlatBuffer, ModuleBuffer } from '../../bindings';

export class DashQLParser extends DashQLParserBindings {
    protected path: string;

    constructor(path: string | null = null) {
        super();
        this.path = path ?? dashql_parser_wasm;
    }

    protected instantiate(moduleOverrides: Partial<DashQLParserModule>): Promise<DashQLParserModule> {
        return dashql_parser_init({
            ...moduleOverrides,
            locateFile: (path: string) => {
                if (path.endsWith('dashql_parser_web.wasm'))
                    return this.path;
                return path;
            }
        });
    }

    public static async create(path: string | null = null): Promise<DashQLParser> {
        const parser = new DashQLParser(path);
        await DashQLParserBindings.init(parser);
        return parser;
    }
}

export {
    proto,
    FlatBuffer,
    ModuleBuffer
}
