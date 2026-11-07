/**
 * List the calculated dimensions of a model, then read one of them with its formula.
 */

call cdp.sdm_calc_dims_list (model_api_name_or_id => 'AccountRevenue');

call cdp.sdm_calc_dim_get (
    model_api_name_or_id => 'AccountRevenue',
    calculated_dimension_name_or_id => 'Revenue_Tier'
);
