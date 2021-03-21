export interface DashQLAnalyzerModule extends EmscriptenModule {
    stackSave: typeof stackSave;
    stackRestore: typeof stackRestore;
    stackAlloc: typeof stackAlloc;

    ccall: typeof ccall;
}
