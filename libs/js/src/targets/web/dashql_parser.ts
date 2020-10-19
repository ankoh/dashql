// Copyright (c) 2020 The DashQL Authors

import dashql_parser_wasm from '../../parser/dashql_parser_web.wasm';
import dashql_parser_init from '../../parser/dashql_parser_web.js';

import { DashQLParserModule } from '../../parser/dashql_parser_module';
import { DashQLParserBindings } from '../../parser/bindings';

export class DashQLParser extends DashQLParserBindings {
    protected instantiate(moduleOverrides: Partial<DashQLParserModule>): Promise<DashQLParserModule> {
        return dashql_parser_init({
            ...moduleOverrides,
            locateFile(path: string) {
                if (path.endsWith('.wasm'))
                    return dashql_parser_wasm;
                return path;
            }
        });
    }
}
