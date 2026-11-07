/**
 * Step 2 of communication capping.
 *
 * `:dimension_id` comes from the previous step, and `:data_space_id` is an `id` of `dataspace_list`. The `id` in the result is `:configuration_id`.
 */

CALL cdp.communication_capping_configuration_create (name => 'Marketing caps', data_comm_cap_dataspaces => [(dataspace_id = :data_space_id)], data_comm_cap_related_dims => [(api_name = 'Channel', data_comm_cap_dim_id = :dimension_id)]);
