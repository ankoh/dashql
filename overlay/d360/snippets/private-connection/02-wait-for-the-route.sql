/**
 * Step 2 of a private connection.
 *
 * Repeat until `cloud_provider.status` is `Ready`, then update the Snowflake network policy. The `id` in the result is the `:route_id` of the next step.
 */

CALL cdp.private_network_route_get (route_id_or_name => 'Snowflake_Prod');
