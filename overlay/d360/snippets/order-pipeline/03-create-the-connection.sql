/**
 * Step 3 of the order pipeline, uses the attributes of step 2.
 *
 * Connect to Snowflake as `SnowflakeConn`. `:snowflake_user` and `:snowflake_private_key` are the credentials, as parameters so that they stay out of the script.
 */

CALL cdp.connection_create (
  connector_type => 'SNOWFLAKE',
  label => 'Snowflake prod',
  name => 'SnowflakeConn',
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
