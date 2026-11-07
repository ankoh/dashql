/**
 * Rotate the Snowflake key of a connection by replacing it as a whole. The new key is `:snowflake_new_private_key`, the user is `:snowflake_user`.
 *
 * Everything not in the request is replaced, so read the connection first and copy its settings. Resend `credentials`, reads return them masked.
 */

call cdp.connection_get (connection_id => '9cgaj0000012O5hAAE');

call cdp.connection_replace (
    connection_id => '9cgaj0000012O5hAAE',
    connector_type => 'SNOWFLAKE',
    label => 'Snowflake prod',
    name => 'snowflake_prod',
    method => 'Ingress',
    credentials => [
        (param_name = 'authenticationOption', value = 'KeyPair'),
        (param_name = 'user', value = :snowflake_user),
        (param_name = 'privateKey', value = :snowflake_new_private_key)
    ],
    parameters => [
        (param_name = 'accountUrl', value = 'https://my-account.snowflakecomputing.com'),
        (param_name = 'region', value = 'us-west-2'),
        (param_name = 'warehouse', value = 'LOAD_WH'),
        (param_name = 'hasPrivateNetworkRoute', value = 'false')
    ]
);
