/**
 * Open a private route from the Data 360 tenant to the PrivateLink endpoint service of an Amazon MSK cluster. Create the route before the connection that uses it.
 *
 * `route.type` picks the shape of the route: `AmazonMsk` also needs `broker_endpoints`, while Redshift needs only the service name. The route is usable when `cloud_provider.status` is `Ready`, which takes several minutes. Don't retry the call blindly, a route for the same connection URL answers with a conflict.
 */

call cdp.private_network_route_create (
    name => 'MSK_Prod',
    label => 'MSK Prod',
    description => 'PrivateLink route to the prod MSK cluster',
    cloud_provider => (type = 'AmazonWebServices'),
    route => (
        type = 'AmazonMsk',
        service_name = 'com.amazonaws.vpce.us-east-1.vpce-svc-0a1b2c3d4e5f67890',
        broker_endpoints = [
            'b-1.prod.kafka.us-east-1.amazonaws.com:9094',
            'b-2.prod.kafka.us-east-1.amazonaws.com:9094'
        ]
    )
);

call cdp.private_network_route_get (route_id_or_name => 'MSK_Prod');
