/**
 * Delete a model for good, with everything in it. Read the model first to see what goes.
 */

call d360.sdm_get (model_api_name_or_id => 'AccountRevenue');

call d360.sdm_delete (model_api_name_or_id => 'AccountRevenue');
