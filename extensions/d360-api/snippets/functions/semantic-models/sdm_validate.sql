/**
 * Check the structure and configuration of a model and report errors. Run it after building a model and before querying it, then read the validity and the errors in the result.
 */

call d360.sdm_validate (model_api_name_or_id => 'AccountRevenue');

call d360.sdm_dependencies (model_api_name_or_id => 'AccountRevenue');
