/**
 * List the functions the semantic engine supports in formulas, to check a calculated field's formula before saving it. The model is optional.
 */

call cdp.sdm_formula_metadata (model_api_name_or_id => 'AccountRevenue');

call cdp.sdm_calc_measure_create (
    model_api_name_or_id => 'AccountRevenue',
    label => 'Average Deal',
    api_name => 'Average_Deal',
    data_type => 'Number',
    aggregation_type => 'UserAgg',
    expression => $$AVG([Opportunity].[Amount])$$
);
