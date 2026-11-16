/**
 * Copy a model into a new one that can change independently, for a variation or an experiment. The copy is a separate model, so read it back to check it.
 */

call d360.sdm_clone (model_api_name_or_id => 'AccountRevenue', api_name => 'AccountRevenue_Test');

call d360.sdm_get (model_api_name_or_id => 'AccountRevenue_Test');
