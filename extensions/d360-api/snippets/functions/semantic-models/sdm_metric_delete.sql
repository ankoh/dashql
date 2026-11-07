/**
 * Delete a metric from a model. Read it first to be sure it is the one.
 */

call cdp.sdm_metric_get (model_api_name_or_id => 'AccountRevenue', metric_name_or_id => 'Annual_Revenue_md');

call cdp.sdm_metric_delete (model_api_name_or_id => 'AccountRevenue', metric_name_or_id => 'Annual_Revenue_md');
