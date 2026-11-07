/**
 * Run a named command on a connection, here `GET_SCHEMAS`. The result tells whether the command started, not what it found.
 *
 * Only `GET_SCHEMAS` is named by the spec. To read the schemas themselves, use `connection_db_schemas_list`.
 */

call cdp.existing_connection_action_run (command => 'GET_SCHEMAS', connection_id => '9cgaj0000012O5hAAE');

call cdp.connection_db_schemas_list (
    connection_id => '9cgaj0000012O5hAAE',
    advanced_attributes => (database = 'SNOWFLAKE_SAMPLE_DATA')
);
