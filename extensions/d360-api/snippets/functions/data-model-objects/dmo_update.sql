/**
 * Relabel a custom DMO and add a field to it.
 *
 * The developer name can't change, and every field needs a data type. The result shows the state before the patch, so read the DMO back to see the new field.
 */

call cdp.dmo_update (
    data_model_object_name => 'SalesOrders__dlm',
    label => 'Sales Orders',
    description => 'One row per order, with the amount and the buyer',
    fields => [(name = 'DiscountCode', label = 'Discount Code', is_primary_key = false, data_type = 'Text')]
);

call cdp.dmo_get (data_model_object_name => 'SalesOrders__dlm');
