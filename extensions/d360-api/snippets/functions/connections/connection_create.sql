/**
 * Connect Data 360 to a Snowflake account with key pair authentication. The credentials are `:snowflake_user` and `:snowflake_private_key`, as parameters to keep them out of the script.
 *
 * The attribute names in `credentials` and `parameters` differ per connector, `connector_metadata` lists them. The private key is passed as its content, not a path. Read `status` of the connection afterwards, it is `Processing` while the handshake runs, then `Active` or `Error`.
 */

call cdp.connection_create (
    connector_type => 'SNOWFLAKE',
    label => 'Snowflake prod',
    name => 'snowflake_prod',
    method => 'Ingress',
    credentials => [
        (param_name = 'authenticationOption', value = 'KeyPair'),
        (param_name = 'user', value = :snowflake_user),
        (param_name = 'privateKey', value = :snowflake_private_key)
    ],
    parameters => [
        (param_name = 'accountUrl', value = 'https://my-account.snowflakecomputing.com'),
        (param_name = 'region', value = 'us-west-2'),
        (param_name = 'warehouse', value = 'LOAD_WH'),
        (param_name = 'hasPrivateNetworkRoute', value = 'false')
    ]
);

call cdp.connection_list (connector_type => 'SNOWFLAKE', label => 'Snowflake prod');
