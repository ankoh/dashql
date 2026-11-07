/**
 * Delete field mappings of a mapping by the mapping's name alone.
 *
 * The path names no field, and the spec doesn't say which field is removed or whether all of them are. Prefer `dmo_field_mapping_delete`, which names the field. Read the mapping before and after.
 */

call cdp.dmo_mapping_get (
    object_source_target_map_developer_name => 'Orders_snow_SalesOrders',
    dataspace => 'default'
);

call cdp.dmo_field_mappings_delete (
    object_source_target_map_developer_name => 'Orders_snow_SalesOrders',
    dataspace => 'default'
);
