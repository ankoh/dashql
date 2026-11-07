/**
 * Delete a model for good, with everything in it. Read the model first to see what goes.
 */

call cdp.sdm_get (model_api_name_or_id => 'AccountRevenue');

call cdp.sdm_delete (model_api_name_or_id => 'AccountRevenue');
