/**
 * List the mappings that feed a data model object, narrowed to one data lake object as source.
 *
 * A 404 can mean the DMO has no mappings rather than a failure. `developer_name` of a row is what `dmo_mapping_get` and the delete calls take.
 */

call cdp.dmo_mapping_list (
    dmo_developer_name => 'SalesOrders__dlm',
    dlo_developer_name => 'Orders_snow__dll',
    dataspace => 'default',
    _pages => 2
);
