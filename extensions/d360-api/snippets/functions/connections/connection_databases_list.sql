/**
 * List the databases a connection can see, the first step of browsing a database source.
 *
 * This is a read even though it uses POST, and it takes no body. It works for JDBC-shaped connectors only, and the `databases` column holds a list.
 */

call cdp.connection_databases_list (connection_id => '9cgaj0000012O5hAAE');

call cdp.connection_db_schemas_list (
    connection_id => '9cgaj0000012O5hAAE',
    advanced_attributes => (database = 'SNOWFLAKE_SAMPLE_DATA')
);
