// Copyright (c) 2020 The DashQL Authors

import dashql_core_wasm from '../../wasm/dashql_core_web.wasm';
import dashql_core_init from '../../wasm/dashql_core_web.js';

import { DashQLCoreModule } from '../../wasm/dashql_core_module';
import { DashQLCoreBindings } from '../../';

export class DashQLCore extends DashQLCoreBindings {
    protected path: string;

    constructor(path: string | null = null) {
        super();
        this.path = path ?? dashql_core_wasm;
    }

    protected instantiate(moduleOverrides: Partial<DashQLCoreModule>): Promise<DashQLCoreModule> {
        return dashql_core_init({
            ...moduleOverrides,
            locateFile: (path: string) => {
                if (path.endsWith('dashql_core_web.wasm'))
                    return this.path;
                return path;
            }
        });
    }

    public static async create(path: string | null = null): Promise<DashQLCore> {
        const core = new DashQLCore(path);
        await DashQLCoreBindings.init(core);
        return core;
    }
}

export * from '../../';
