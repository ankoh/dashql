/**
 * Step 3 of a private connection.
 *
 * Connect through `:route_id`. `:snowflake_user` and `:snowflake_private_key` are the credentials, as parameters so that they stay out of the script.
 */

CALL cdp.connection_create (
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
    (param_name = 'region', value = 'us-west-2'),
    (param_name = 'warehouse', value = 'LOAD_WH'),
    (param_name = 'hasPrivateNetworkRoute', value = 'true'),
    (param_name = 'outboundnetworkconnection', value = :route_id)
  ]
);
