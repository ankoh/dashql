/**
 * Read one data object of a model with its dimensions and measurements. Find its name in the data object list first.
 */

call cdp.sdm_data_objects_list (model_api_name_or_id => 'AccountRevenue');

call cdp.sdm_data_object_get (model_api_name_or_id => 'AccountRevenue', data_object_name_or_id => 'Account');
