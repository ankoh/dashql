/**
 * Create a capping configuration that ties dimensions to a data space and will hold the rules. Create the dimensions first, since it refers to their ids.
 *
 * Keep the returned `id`, because no call lists configurations. The sample comes back `PROCESSING`, so poll `communication_capping_configuration_get` until the status changes.
 */

call cdp.communication_capping_configuration_create (
    name => 'Marketing caps',
    description => 'Caps for marketing sends',
    data_comm_cap_dataspaces => [(dataspace_id = '0vhxx0000000001AAA')],
    data_comm_cap_related_dims => [
        (api_name = 'Channel', data_comm_cap_dim_id = '1CDxx0000000001GAA'),
        (api_name = 'Brand', data_comm_cap_dim_id = '1CDxx0000000002GAA')
    ]
);
