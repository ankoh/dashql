/**
 * Delete a calculated measurement from a model. Read it first, since metrics and queries built on it stop working.
 */

call cdp.sdm_calc_measure_get (
    model_api_name_or_id => 'AccountRevenue',
    calculated_measurement_name_or_id => 'Total_Pipeline'
);

call cdp.sdm_calc_measure_delete (
    model_api_name_or_id => 'AccountRevenue',
    calculated_measurement_name_or_id => 'Total_Pipeline',
    relationship_cascade_delete => true
);
