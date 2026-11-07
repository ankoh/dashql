/**
 * List the private network routes of the org, for example to find the one a connection should use.
 *
 * An error here doesn't prove the request is wrong: the list is feature gated and can fail when the org has no routes.
 */

call cdp.private_network_route_list (limit => 100, offset => 0);

call cdp.private_network_route_get (route_id_or_name => 'Redshift_Prod');
