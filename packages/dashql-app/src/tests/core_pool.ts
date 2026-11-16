import { DashQL, type DashQLModuleOptions } from '@ankoh/dashql';

declare global {
    var DASHQL_PRECOMPILED: Promise<Uint8Array> | undefined;
    var __DASHQL_TEST_CORE_WASM_MODULE__: Promise<WebAssembly.Module> | undefined;
    var __DASHQL_TEST_DASHBOARD_CORE_INSTANCE__: Promise<DashQL> | undefined;
    var __DASHQL_TEST_CORE_CREATIONS__: number | undefined;
    var __DASHQL_TEST_CORE_FACTORY__: ((options?: DashQLModuleOptions) => Promise<DashQL>) | undefined;
    var __DASHQL_TEST_RESET_CORE_INSTANCE__: (() => void) | undefined;
}

export async function createPrecompiledTestCore(bytes: Promise<Uint8Array>): Promise<DashQL> {
    globalThis.__DASHQL_TEST_CORE_WASM_MODULE__ ??= bytes.then(binary => WebAssembly.compile(binary.slice().buffer));
    const module = await globalThis.__DASHQL_TEST_CORE_WASM_MODULE__;
    return DashQL.create({ module });
}

export function installSharedCoreTestPool(): void {
    const create = DashQL.create.bind(DashQL);
    const instantiated = DashQL.instantiated.bind(DashQL);
    let shared: Promise<DashQL> | undefined;
    let resolved: DashQL | null = null;
    // This override exists only in the test iframe, never in a production entry point.
    DashQL.create = async (options?: DashQLModuleOptions) => {
        shared ??= globalThis.__DASHQL_TEST_CORE_FACTORY__?.(options) ?? create(options);
        const instance = await shared;
        resolved = instance;
        globalThis.__DASHQL_TEST_RESET_CORE_INSTANCE__ = () => instance.resetUnsafe();
        return instance;
    };
    // The shared core may come from the module of the dashboard, the module of the frame then never instantiates.
    // Whoever asks for the instantiated core, e.g. the runtime of a test, gets the shared one once it is created.
    DashQL.instantiated = () => resolved ?? instantiated();
}
