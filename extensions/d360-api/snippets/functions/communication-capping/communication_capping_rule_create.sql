/**
 * Cap the messages sent for a combination of dimension values, here at most 10 SMS in the month of June 2026.
 *
 * `dim_value_ids` are the ids of values from `communication_capping_dimension_list`. The rule has no frequency or limit type field, and no source says how the API sets them.
 */

call cdp.communication_capping_rule_create (
    id => '1CCxx0000004C92AAE',
    api_name => 'Sms_daily_hnw',
    limits => 10,
    start_date => '2026-06-01T00:00:00Z',
    end_date => '2026-06-30T00:00:00Z',
    data_comm_cap_rule_dim => [(dim_id = '1CDxx0000000001GAA', dim_value_ids = ['1CVxx0000000002GAA'])]
);
