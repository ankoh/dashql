/**
 * Change a data object of a model, such as its label or whether it includes every source field. Read it back to see the result.
 */

call cdp.sdm_data_object_update (
    model_api_name_or_id => 'AccountRevenue',
    data_object_name_or_id => 'Account',
    label => 'Customer Account',
    data_object_type => 'Dmo',
    should_include_all_fields => true
);

call cdp.sdm_data_object_get (model_api_name_or_id => 'AccountRevenue', data_object_name_or_id => 'Account');
