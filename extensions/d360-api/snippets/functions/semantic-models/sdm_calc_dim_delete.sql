/**
 * Delete a calculated dimension from a model. Read it first, since anything built on it stops working.
 */

call d360.sdm_calc_dim_get (
    model_api_name_or_id => 'AccountRevenue',
    calculated_dimension_name_or_id => 'Revenue_Tier'
);

call d360.sdm_calc_dim_delete (
    model_api_name_or_id => 'AccountRevenue',
    calculated_dimension_name_or_id => 'Revenue_Tier',
    relationship_cascade_delete => true
);
