/**
 * List the data objects of a model with their fields. The semantic field names you need in relationships and formulas come from here.
 */

call d360.sdm_data_objects_list (model_api_name_or_id => 'AccountRevenue');

call d360.sdm_data_object_get (model_api_name_or_id => 'AccountRevenue', data_object_name_or_id => 'Account');
