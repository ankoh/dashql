/**
 * Check that a new or changed mapping from a data lake object to a DMO became active, and see its field mappings.
 *
 * Compare `status` without regard to case: it can be `ACTIVE`, `CREATING` or `UPDATING`. `field_mappings` also holds system fields the server added.
 */

call cdp.dmo_mapping_list (dmo_developer_name => 'SalesOrders__dlm', dataspace => 'default');

call cdp.dmo_mapping_get (
    object_source_target_map_developer_name => 'Orders_snow_SalesOrders',
    dataspace => 'default'
);
