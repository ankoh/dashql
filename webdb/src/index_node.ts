// Copyright (c) 2020 The DashQL Authors

export * from "./iterator";
export * from "./value";
export * from "./webdb_bindings";
export * from "./webdb_buffer";

import webdb_api_wasm from './wasm/webdb_wasm_node.wasm';
import webdb_api_init from './wasm/webdb_wasm_node.js';
import { WebDBModule } from './wasm/webdb_module';
import { WebDBBindings } from './webdb_bindings';

export class WebDB extends WebDBBindings {
    protected path: string;
    constructor(path: string | null = null) {
        super();
        this.path = path ?? webdb_api_wasm;
    }
    protected instantiate(moduleOverrides: Partial<WebDBModule>): Promise<WebDBModule> {
        return webdb_api_init({
            ...moduleOverrides,
            locateFile: (path: string) => {
                if (path.endsWith('webdb_wasm_node.wasm'))
                    return this.path;
                return path;
            }
        });
    }
}
