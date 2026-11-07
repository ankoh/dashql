/**
 * Add a calculated measurement, a numeric formula over model fields that is computed at query time, here the open pipeline of the opportunities. Metrics usually build on these.
 *
 * A formula that aggregates needs `aggregation_type => 'UserAgg'`. The filters scope the rows the formula sees, and `filter_logic` combines them by index.
 */

call cdp.sdm_calc_measure_create (
    model_api_name_or_id => 'AccountRevenue',
    label => 'Total Pipeline',
    api_name => 'Total_Pipeline',
    description => 'Amount of the open opportunities',
    data_type => 'Number',
    aggregation_type => 'UserAgg',
    decimal_place => 2,
    syntax => 'Tua',
    directionality => 'Up',
    should_treat_nulls_as_zeros => true,
    expression => $$SUM([Opportunity].[Amount])$$,
    filters => [
        (field_name = 'IsClosed', operator = 'Equals', value = 'false'),
        (field_name = 'StageName', operator = 'In', values = ['Prospecting', 'Qualification', 'Proposal'])
    ],
    filter_logic => '1 AND 2'
);

call cdp.sdm_calc_measure_get (
    model_api_name_or_id => 'AccountRevenue',
    calculated_measurement_name_or_id => 'Total_Pipeline'
);
