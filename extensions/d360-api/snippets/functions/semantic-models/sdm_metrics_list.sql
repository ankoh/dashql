/**
 * List the metrics of a model, then read one of them.
 */

call cdp.sdm_metrics_list (model_api_name_or_id => 'AccountRevenue');

call cdp.sdm_metric_get (model_api_name_or_id => 'AccountRevenue', metric_name_or_id => 'Annual_Revenue_md');
