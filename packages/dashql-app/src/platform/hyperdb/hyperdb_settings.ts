export const HYPERDB_WASM_ENGINE_SETTINGS = Object.freeze({
    identifier_resolution: 'case_insensitive',
    experimental_view_creation: true,
    experimental_persisted_view_creation: true,
    experimental_hyper_introspection_functions: true,
    experimental_data_type_persistence: true,
    log_json_export: true,
    log_file_size_limit: '1M',
    log_file_max_count: 10,
});
