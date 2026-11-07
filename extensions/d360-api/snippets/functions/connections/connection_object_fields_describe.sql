/**
 * List the fields of one table on a database connection, with their types, before you build a data stream on it.
 *
 * Find `resource_name` with `connection_objects_list`. `advanced_attributes` is required by the spec, pass `()` if the connector needs no keys.
 */

call cdp.connection_objects_list (
    connection_id => '9cgaj0000012O5hAAE',
    advanced_attributes => (database = 'SNOWFLAKE_SAMPLE_DATA', schema = 'TPCH_SF1')
);

call cdp.connection_object_fields_describe (
    connection_id => '9cgaj0000012O5hAAE',
    resource_name => 'CUSTOMER',
    advanced_attributes => (database = 'SNOWFLAKE_SAMPLE_DATA', schema = 'TPCH_SF1')
);
