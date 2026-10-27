export const HYPERDB_WASM_ENGINE_SETTINGS = Object.freeze({
    default_database_version: 4,
    identifier_resolution: 'case_insensitive',
    experimental_view_creation: true,
    experimental_persisted_view_creation: true,
    experimental_hyper_introspection_functions: true,
    experimental_data_type_persistence: true,
    experimental_multidimensional_arrays: true,
    experimental_external_http_location: true,
    experimental_external_metaquery: true,
    experimental_persisted_external_tables: true,
    enable_raw_sql: true,
    raw_sql_format_table_scan: true,
    enable_row_types: true,
    http_location_allowlist: ['*'],
    log_json_export: false,
    log_file_size_limit: '1M',
    log_file_max_count: 10,
    // Log the process memory and the load every second, also without load, for the live connection overview.
    // An event has about 3KB, the log files then rotate about every 5 minutes.
    log_resource_usage_interval: '1s',
    log_resource_usage_always: 1,
});

/// The setting that runs the queries on the experimental execution backend of the wasm module.
/// Builds of hyperdb-wasm without the backend reject it, see isUnknownHyperDBSettingError().
export const EXPERIMENTAL_WASM_BACKEND_SETTING = 'experimental_wasm_backend';

/// Did the engine reject a startup setting that it does not know?
/// The engine names the setting in the detail of the error, the test clients put the whole error into the message.
export function isUnknownHyperDBSettingError(error: unknown, setting: string): boolean {
    const message = error instanceof Error ? error.message : String(error);
    const detail = error instanceof Error && 'detail' in error ? String(error.detail) : '';
    const unknown = `No internal setting named '${setting}'`;
    return message.includes(unknown) || detail.includes(unknown);
}
