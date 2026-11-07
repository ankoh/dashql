/**
 * Delete a custom data model object you no longer need.
 *
 * Make sure no streams, mappings, insights or segments reference it first; sources say the delete may cascade to dependent objects. The mappings of the DMO show what still feeds it.
 */

call cdp.dmo_get (data_model_object_name => 'SalesOrders__dlm');

call cdp.dmo_mapping_list (dmo_developer_name => 'SalesOrders__dlm', dataspace => 'default');

call cdp.dmo_delete (data_model_object_name => 'SalesOrders__dlm');
