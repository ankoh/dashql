/**
 * Step 3 of the semantic model.
 *
 * Add a calculated measure over that object.
 */

CALL cdp.sdm_calc_measure_create (model_api_name_or_id => 'AccountRevenue', label => 'Total Revenue', api_name => 'Total_Revenue', data_type => 'Number', aggregation_type => 'UserAgg', expression => $$SUM([Account].[AnnualRevenue])$$);
