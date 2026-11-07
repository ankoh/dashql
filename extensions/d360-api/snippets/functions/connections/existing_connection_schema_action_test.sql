/**
 * Test the schema of a saved connection, for example after you changed it.
 *
 * Read the schema first to see what is being tested.
 */

call cdp.connection_schema_list (connection_id => '9cgaj0000012O5hAAE');

call cdp.existing_connection_schema_action_test (connection_id => '9cgaj0000012O5hAAE');
