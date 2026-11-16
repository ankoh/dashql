/**
 * List what a model depends on outside itself. Read it before deleting or changing the model or its source objects.
 */

call d360.sdm_dependencies (model_api_name_or_id => 'AccountRevenue');

call d360.sdm_delete (model_api_name_or_id => 'AccountRevenue');
