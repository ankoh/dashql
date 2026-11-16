/**
 * Change a calculated dimension, usually its formula, here with a higher threshold for the top tier and a new label.
 */

call d360.sdm_calc_dim_update (
    model_api_name_or_id => 'AccountRevenue',
    calculated_dimension_name_or_id => 'Revenue_Tier',
    label => 'Revenue Tier (2026)',
    data_type => 'Text',
    expression => $$IF [Account].[AnnualRevenue] > 5000000 THEN 'Enterprise' ELSE 'SMB' END$$
);

call d360.sdm_calc_dim_get (
    model_api_name_or_id => 'AccountRevenue',
    calculated_dimension_name_or_id => 'Revenue_Tier'
);
