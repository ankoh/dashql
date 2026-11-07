/**
 * Remove one field from a mapping and keep the rest, for governance or cleanup.
 *
 * Field mapping names follow `<source>_fieldmap_<target>`. Read the mapping to see them.
 */

call cdp.dmo_mapping_get (
    object_source_target_map_developer_name => 'Orders_snow_SalesOrders',
    dataspace => 'default'
);

call cdp.dmo_field_mapping_delete (
    mapping_name => 'Orders_snow_SalesOrders',
    field_mapping_name => 'discount_code__c_fieldmap_DiscountCode__c',
    dataspace => 'default'
);
