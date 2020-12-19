export interface WebDBModule extends EmscriptenModule {
    stackSave: typeof stackSave;
    stackRestore: typeof stackRestore;

    ccall: typeof ccall;
    allocate: typeof allocate;

    ALLOC_STACK: typeof ALLOC_STACK;
    ALLOC_NORMAL: typeof ALLOC_NORMAL;
}
