/**
 * Change the pair of one field in an existing mapping, naming the field mapping in the path.
 *
 * To add fields without naming one, use `dmo_field_mapping_add`. The mapping goes through `UPDATING`: read it with `dmo_mapping_get` until it is active again.
 */

call cdp.dmo_field_mapping_update (
    object_source_target_map_developer_name => 'Orders_snow_SalesOrders',
    field_source_target_map_developer_name => 'discount_code__c_fieldmap_DiscountCode__c',
    dataspace => 'default',
    source_entity_developer_name => 'Orders_snow__dll',
    target_entity_developer_name => 'SalesOrders__dlm',
    field_mapping => [(
        source_field_developer_name = 'purchased_at__c',
        target_field_developer_name = 'PurchasedAt__c'
    )]
);

call cdp.dmo_mapping_get (
    object_source_target_map_developer_name => 'Orders_snow_SalesOrders',
    dataspace => 'default'
);
