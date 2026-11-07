/**
 * Step 1 of a private connection.
 *
 * Create a PrivateLink route to Snowflake.
 */

call cdp.private_network_route_create (
    name => 'Snowflake_Prod',
    label => 'Snowflake Prod',
    description => 'PrivateLink route to the prod Snowflake account',
    route => (
        type = 'Snowflake',
        service_name = 'com.amazonaws.vpce.us-west-2.vpce-svc-0123456789abcdef0',
        account_url = 'https://my-account.snowflakecomputing.com'
    )
);
