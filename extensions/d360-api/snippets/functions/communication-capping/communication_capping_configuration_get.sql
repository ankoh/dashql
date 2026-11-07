/**
 * Check a capping configuration after you created or changed it: its data spaces, dimensions and status.
 *
 * There is no call that lists configurations, so keep the `id` that create returned. This result calls the state `status`, while create and update call it `data_communication_cap_status`.
 */

call cdp.communication_capping_configuration_create (
    name => 'Marketing caps',
    description => 'Caps for marketing sends',
    data_comm_cap_dataspaces => [(dataspace_id = '0vhxx0000000001AAA')],
    data_comm_cap_related_dims => [(api_name = 'Channel', data_comm_cap_dim_id = '1CDxx0000000001GAA')]
);

call cdp.communication_capping_configuration_get (id => '1CCxx0000004C92AAE');
