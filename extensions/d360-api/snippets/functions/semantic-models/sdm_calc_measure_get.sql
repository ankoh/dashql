/**
 * Read one calculated measurement with its formula and dependencies. List the calculated measurements first to find its name.
 */

call cdp.sdm_calc_measures_list (model_api_name_or_id => 'AccountRevenue', name => 'Total_Pipeline');

call cdp.sdm_calc_measure_get (
    model_api_name_or_id => 'AccountRevenue',
    calculated_measurement_name_or_id => 'Total_Pipeline'
);
