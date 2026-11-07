/**
 * List the dimensions of one data object of a model, the fields a query groups and filters by. A name filter narrows the list.
 */

call cdp.sdm_dimensions_list (
    model_api_name_or_id => 'AccountRevenue',
    data_object_name_or_id => 'Account',
    name => 'Region'
);

call cdp.sdm_measurements_list (model_api_name_or_id => 'AccountRevenue', data_object_name_or_id => 'Account');
