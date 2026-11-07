/**
 * Step 4 of communication capping.
 *
 * Connect an activation target. `:activation_target_id` is an `id` of `activation_target_list`, and `:dimension_id` and `:dimension_value_id` come from the first step.
 */

CALL cdp.communication_capping_activation_target_metadata_map (activation_target_id => :activation_target_id, activation_target_name => 'Email_capped', data_comm_cap_dim_info => [(data_comm_cap_dim_id = :dimension_id, data_comm_cap_dim_value_id = :dimension_value_id)]);
