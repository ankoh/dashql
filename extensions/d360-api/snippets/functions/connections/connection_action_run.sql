/**
 * Run a command on a connector type without creating a connection, here `GET_SCHEMAS` for Snowflake.
 *
 * The call has no `credentials` or `parameters`, and no source says which keys `command_attributes` takes. See `existing_connection_action_run` for the command names.
 */

call cdp.connection_action_run (command => 'GET_SCHEMAS', connector_type => 'SNOWFLAKE', method => 'Ingress');
