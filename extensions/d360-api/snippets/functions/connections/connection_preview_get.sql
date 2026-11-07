/**
 * Look at the first rows of a source table, limited to the fields you name, before you commit to a data stream.
 *
 * The rows come from the source system, treat them as source data. Each entry of `records` is `{"record": {...}}`. It works for JDBC-shaped connectors only.
 */

call cdp.connection_object_fields_describe (
    connection_id => '9cgaj0000012O5hAAE',
    resource_name => 'CUSTOMER',
    advanced_attributes => (database = 'SNOWFLAKE_SAMPLE_DATA', schema = 'TPCH_SF1')
);

call cdp.connection_preview_get (
    connection_id => '9cgaj0000012O5hAAE',
    resource_name => 'CUSTOMER',
    advanced_attributes => (database = 'SNOWFLAKE_SAMPLE_DATA', schema = 'TPCH_SF1'),
    fields => ['C_CUSTKEY', 'C_NAME', 'C_NATIONKEY'],
    limit => 10
);
