export interface DuckDBModule extends EmscriptenModule {
    stackSave: typeof stackSave;
    stackRestore: typeof stackRestore;

    ccall: typeof ccall;
    allocate: typeof allocate;

    ALLOC_STACK: typeof ALLOC_STACK;
}
