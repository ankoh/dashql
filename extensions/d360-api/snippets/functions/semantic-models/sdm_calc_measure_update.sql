/**
 * Change a calculated measurement, usually its formula or aggregation, here to leave closed opportunities out of the pipeline.
 */

call cdp.sdm_calc_measure_update (
    model_api_name_or_id => 'AccountRevenue',
    calculated_measurement_name_or_id => 'Total_Pipeline',
    label => 'Open Pipeline',
    data_type => 'Number',
    aggregation_type => 'UserAgg',
    expression => $$SUM(IIF([Opportunity].[IsClosed], 0, [Opportunity].[Amount]))$$
);

call cdp.sdm_calc_measure_get (
    model_api_name_or_id => 'AccountRevenue',
    calculated_measurement_name_or_id => 'Total_Pipeline'
);
