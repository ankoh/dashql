/**
 * Read one private network route, to check whether it is ready or to copy the values you need on the cloud side.
 *
 * `cloud_provider.status` is the readiness signal. For Snowflake, `cloud_provider.dataCloudVpceId` is the value to allow in the network policy.
 */

call cdp.private_network_route_list (limit => 20);

call cdp.private_network_route_get (route_id_or_name => 'Redshift_Prod');
