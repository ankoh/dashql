/**
 * List the measurements of one data object of a model, the numeric fields a query can aggregate. A name filter narrows the list.
 */

call cdp.sdm_measurements_list (
    model_api_name_or_id => 'AccountRevenue',
    data_object_name_or_id => 'Account',
    name => 'AnnualRevenue'
);

call cdp.sdm_dimensions_list (model_api_name_or_id => 'AccountRevenue', data_object_name_or_id => 'Account');
