/**
 * Step 3 of communication capping.
 *
 * Limit the emails of a month in `:configuration_id`, for `:dimension_id` and `:dimension_value_id`.
 */

call cdp.communication_capping_rule_create (
    id => :configuration_id,
    api_name => 'Email_daily',
    limits => 10,
    start_date => '2027-05-01T00:00:00Z',
    end_date => '2027-05-31T00:00:00Z',
    data_comm_cap_rule_dim => [(dim_id = :dimension_id, dim_value_ids = [:dimension_value_id])]
);
