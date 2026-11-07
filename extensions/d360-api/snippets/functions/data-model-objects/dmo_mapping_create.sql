/**
 * Map a data lake object onto a data model object, field by field.
 *
 * One call covers one source and target pair. The `label` becomes the developer name of the mapping. The mapping is `CREATING` at first: read it until its status is `ACTIVE`.
 */

call cdp.dmo_mapping_create (
    dataspace => 'default',
    label => 'Orders_snow_SalesOrders',
    source_entity_developer_name => 'Orders_snow__dll',
    target_entity_developer_name => 'SalesOrders__dlm',
    field_mapping => [
        (source_field_developer_name = 'order_id__c', target_field_developer_name = 'OrderId__c'),
        (source_field_developer_name = 'individual_id__c', target_field_developer_name = 'IndividualId__c'),
        (source_field_developer_name = 'total_amount__c', target_field_developer_name = 'TotalAmount__c'),
        (source_field_developer_name = 'purchased_at__c', target_field_developer_name = 'PurchasedAt__c')
    ]
);

call cdp.dmo_mapping_get (
    object_source_target_map_developer_name => 'Orders_snow_SalesOrders',
    dataspace => 'default'
);
