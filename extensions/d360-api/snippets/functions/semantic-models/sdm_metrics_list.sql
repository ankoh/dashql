/**
 * List the metrics of a model, then read one of them.
 */

call d360.sdm_metrics_list (model_api_name_or_id => 'AccountRevenue');

call d360.sdm_metric_get (model_api_name_or_id => 'AccountRevenue', metric_name_or_id => 'Annual_Revenue_md');
