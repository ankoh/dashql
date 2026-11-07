/**
 * Map a capping activation target to the dimension values of its rule, such as Channel = Email, so that segments activated through it are capped.
 *
 * The target has to be of the capping type already, from `activation_target_create`, in a data space linked to the configuration. Read the mapping back afterwards.
 */

call cdp.communication_capping_activation_target_metadata_map (
    activation_target_id => '85UVF000000Dr4v2AC',
    activation_target_name => 'Email_capped',
    data_comm_cap_dim_info => [
        (data_comm_cap_dim_id = '1CDxx0000000001GAA', data_comm_cap_dim_value_id = '1CVxx0000000001GAA'),
        (data_comm_cap_dim_id = '1CDxx0000000002GAA', data_comm_cap_dim_value_id = '1CVxx0000000003GAA')
    ]
);

call cdp.communication_capping_activation_target_metadata_get (activation_target_id => '85UVF000000Dr4v2AC');
