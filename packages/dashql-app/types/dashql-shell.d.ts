declare module '@ankoh/dashql-shell-js' {
    interface DashQLShellModule {
        HEAP8: Int8Array;
        HEAPU8: Uint8Array;
        HEAP16: Int16Array;
        HEAPU16: Uint16Array;
        HEAP32: Int32Array;
        HEAPU32: Uint32Array;
        HEAPF32: Float32Array;
        HEAPF64: Float64Array;
        memory?: WebAssembly.Memory;
        stackSave(): number;
        stackAlloc(size: number): number;
        stackRestore(pointer: number): void;
        _dashql_malloc(length: number): number;
        _dashql_free(pointer: number): void;
        _dashql_delete_owner(ownerPointer: number, ownerDeleter: number): void;
        [name: string]: unknown;
        _dashql_shell_new(catalog: number, terminalColumns: number): number;
        _dashql_shell_destroy(shell: number): void;
        _dashql_shell_resize(shell: number, terminalColumns: number): void;
        _dashql_shell_session_relations_set(shell: number, enabled: boolean): number;
        _dashql_shell_commands_set(shell: number, commands: number, commandsLength: number): number;
        _dashql_shell_prompt_set(shell: number, text: number, textLength: number, result: number): number;
        _dashql_shell_prompt_insert(shell: number, text: number, textLength: number, result: number): number;
        _dashql_shell_prompt_move_left(shell: number, result: number): number;
        _dashql_shell_prompt_move_right(shell: number, result: number): number;
        _dashql_shell_prompt_delete_backward(shell: number, result: number): number;
        _dashql_shell_prompt_delete_forward(shell: number, result: number): number;
        _dashql_shell_prompt_complete(shell: number, limit: number, result: number): number;
        _dashql_shell_prompt_apply_completion(shell: number, candidate: number, result: number): number;
        _dashql_shell_prompt_consume(shell: number, key: number, text: number, textLength: number, result: number): number;
        _dashql_shell_prompt_submit(shell: number, result: number): number;
        _dashql_shell_prompt_result_destroy(result: number): void;
        _dashql_shell_completion_result_destroy(result: number): void;
        _dashql_shell_terminal_open(shell: number, prompt: number, promptLength: number, result: number): number;
        _dashql_shell_terminal_consume(shell: number, key: number, text: number, textLength: number, result: number): number;
        _dashql_shell_terminal_finish_query(shell: number, output: number, outputLength: number, error: boolean, result: number): number;
        _dashql_shell_terminal_query_progress(shell: number, message: number, messageLength: number, advanceFrame: boolean, result: number): number;
        _dashql_shell_terminal_query_progress_clear(shell: number, result: number): number;
        _dashql_shell_terminal_status(shell: number, message: number, messageLength: number, result: number): number;
        _dashql_shell_terminal_result_destroy(result: number): void;
        _dashql_shell_history_export(shell: number, result: number): number;
        _dashql_shell_history_import(shell: number, data: number, dataLength: number, result: number): number;
        _dashql_shell_start_query(shell: number, query: number, queryLength: number, result: number): number;
        _dashql_shell_complete_effect(
            shell: number,
            effectIdLow: number,
            effectIdHigh: number,
            completionStatus: number,
            data: number,
            dataLength: number,
            result: number,
        ): number;
        _dashql_shell_cancel_effect(
            shell: number,
            effectIdLow: number,
            effectIdHigh: number,
            result: number,
        ): number;
        _dashql_shell_result_destroy(result: number): void;
    }

    interface DashQLShellModuleOptions {
        instantiateWasm?: (
            imports: WebAssembly.Imports,
            successCallback: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void,
        ) => WebAssembly.Exports | Promise<WebAssembly.Exports>;
        wasmBinary?: Uint8Array;
        locateFile?: (path: string, prefix: string) => string;
        print?: (text: string) => void;
        printErr?: (text: string) => void;
    }

    function createDashQLShellModule(options?: DashQLShellModuleOptions): Promise<DashQLShellModule>;
    export default createDashQLShellModule;
}

declare module '@ankoh/dashql-shell-wasm?url' {
    const value: string;
    export default value;
}
