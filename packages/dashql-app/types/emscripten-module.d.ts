// Type declarations for Emscripten-generated modules

declare module '@ankoh/dashql-core-js' {
    interface EmscriptenModule {
        // Memory views
        HEAP8: Int8Array;
        HEAPU8: Uint8Array;
        HEAP16: Int16Array;
        HEAPU16: Uint16Array;
        HEAP32: Int32Array;
        HEAPU32: Uint32Array;
        HEAPF32: Float32Array;
        HEAPF64: Float64Array;
        memory: WebAssembly.Memory;

        // Runtime methods
        ccall?: (name: string, returnType: string | null, argTypes: string[], args: any[]) => any;
        cwrap?: (name: string, returnType: string | null, argTypes: string[]) => Function;

        // All exported C functions (with underscore prefix)
        [key: `_${string}`]: any;
    }

    interface EmscriptenModuleOptions {
        // Console output hooks
        print?: (text: string) => void;
        printErr?: (text: string) => void;

        // WASM instantiation override
        instantiateWasm?: (
            imports: WebAssembly.Imports,
            successCallback: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void
        ) => WebAssembly.Exports | Promise<WebAssembly.Exports>;

        // Path configuration
        locateFile?: (path: string, prefix: string) => string;

        // Memory configuration
        INITIAL_MEMORY?: number;
        MAXIMUM_MEMORY?: number;
        ALLOW_MEMORY_GROWTH?: boolean;

        // Callbacks
        onRuntimeInitialized?: () => void;
        onAbort?: (what: any) => void;
    }

    function createDashQLModule(options?: EmscriptenModuleOptions): Promise<EmscriptenModule>;

    export default createDashQLModule;
}
