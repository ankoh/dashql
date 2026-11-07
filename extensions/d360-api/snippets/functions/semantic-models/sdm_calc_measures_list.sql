/**
 * List the calculated measurements of a model, then read one of them with its formula.
 */

call cdp.sdm_calc_measures_list (model_api_name_or_id => 'AccountRevenue');

call cdp.sdm_calc_measure_get (
    model_api_name_or_id => 'AccountRevenue',
    calculated_measurement_name_or_id => 'Total_Pipeline'
);
