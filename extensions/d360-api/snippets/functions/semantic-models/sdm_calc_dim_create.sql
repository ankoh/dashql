/**
 * Add a calculated dimension that sorts rows into groups with a formula, here a revenue tier per account. The data objects the formula names must already be in the model.
 *
 * The formula goes in `$$ ... $$` so its quotes need no escaping. Without `api_name` the server generates one, so read it back.
 */

call cdp.sdm_calc_dim_create (
    model_api_name_or_id => 'AccountRevenue',
    label => 'Revenue Tier',
    api_name => 'Revenue_Tier',
    description => 'Account size by annual revenue',
    data_type => 'Text',
    syntax => 'Tua',
    display_category => 'Discrete',
    sort_order => 'Ascending',
    is_visible => true,
    expression => $$IF [Account].[AnnualRevenue] > 1000000 THEN 'Enterprise' ELSEIF [Account].[AnnualRevenue] > 100000 THEN 'Mid-Market' ELSE 'SMB' END$$
);

call cdp.sdm_calc_dim_get (
    model_api_name_or_id => 'AccountRevenue',
    calculated_dimension_name_or_id => 'Revenue_Tier'
);
