/**
 * Add fields to an existing mapping without recreating it, for example when the source gained a column.
 *
 * The call is on the mapping, so no field mapping is named. The mapping goes through `UPDATING`: read it until it is `ACTIVE` again.
 */

call cdp.dmo_field_mapping_add (
    mapping_name => 'Orders_snow_SalesOrders',
    dataspace => 'default',
    source_entity_developer_name => 'Orders_snow__dll',
    target_entity_developer_name => 'SalesOrders__dlm',
    field_mapping => [
        (source_field_developer_name = 'discount_code__c', target_field_developer_name = 'DiscountCode__c'),
        (source_field_developer_name = 'channel__c', target_field_developer_name = 'Channel__c')
    ]
);

call cdp.dmo_mapping_get (
    object_source_target_map_developer_name => 'Orders_snow_SalesOrders',
    dataspace => 'default'
);
