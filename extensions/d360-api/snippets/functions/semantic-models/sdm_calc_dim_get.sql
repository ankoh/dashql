/**
 * Read one calculated dimension with its formula and dependencies. List the calculated dimensions first to find its name.
 */

call cdp.sdm_calc_dims_list (model_api_name_or_id => 'AccountRevenue', name => 'Revenue_Tier');

call cdp.sdm_calc_dim_get (
    model_api_name_or_id => 'AccountRevenue',
    calculated_dimension_name_or_id => 'Revenue_Tier'
);
