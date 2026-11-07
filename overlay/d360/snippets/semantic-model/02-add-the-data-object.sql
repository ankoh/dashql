/**
 * Step 2 of the semantic model.
 *
 * Add the account object with all its fields.
 */

call cdp.sdm_data_object_create (
    model_api_name_or_id => 'AccountRevenue',
    data_object_name => 'ssot__Account__dlm',
    data_object_type => 'Dmo',
    api_name => 'Account',
    label => 'Account',
    should_include_all_fields => true
);
