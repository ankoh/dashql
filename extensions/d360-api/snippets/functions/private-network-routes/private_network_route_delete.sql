/**
 * Delete a private network route that no data stream uses any more.
 *
 * Move any stream that still uses the route to a different one first. Deleting also removes the endpoint connection from your VPC endpoint service.
 */

call cdp.private_network_route_get (route_id_or_name => 'Redshift_Prod');

call cdp.private_network_route_delete (route_id_or_name => 'Redshift_Prod');
