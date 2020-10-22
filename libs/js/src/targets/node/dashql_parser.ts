// Copyright (c) 2020 The DashQL Authors

import dashql_parser_wasm from '../../parser/dashql_parser_node.wasm';
import dashql_parser_init from '../../parser/dashql_parser_node.js';
import * as proto from '../../proto';

import { DashQLParserModule } from '../../parser/dashql_parser_module';
import { DashQLParserBindings, FlatBuffer } from '../../parser/bindings';

export class DashQLParser extends DashQLParserBindings {
    protected path: string;
    constructor(path: string | null = null) {
        super();
        this.path = path ?? dashql_parser_wasm;
    }
    protected instantiate(moduleOverrides: Partial<DashQLParserModule>): Promise<DashQLParserModule> {
        return dashql_parser_init({
            ...moduleOverrides,
            locateFile(path: string) {
                if (path.endsWith('dashql_parser.wasm'))
                    return this.path;
                return path;
            }
        });
    }
}

export {
    proto,
    FlatBuffer
}
