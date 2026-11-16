/**
 * Delete a custom data model object you no longer need.
 *
 * Make sure no streams, mappings, insights or segments reference it first; sources say the delete may cascade to dependent objects. The mappings of the DMO show what still feeds it.
 */

call d360.dmo_get (data_model_object_name => 'SalesOrders__dlm');

call d360.dmo_mapping_list (dmo_developer_name => 'SalesOrders__dlm', dataspace => 'default');

call d360.dmo_delete (data_model_object_name => 'SalesOrders__dlm');
