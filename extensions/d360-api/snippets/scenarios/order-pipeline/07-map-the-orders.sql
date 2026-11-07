/**
 * Step 7 of the order pipeline, needs the objects of steps 4 and 6.
 *
 * Map the data lake object onto the data model object, then repeat the second call until `status` is `ACTIVE`.
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

call cdp.dmo_mapping_get (object_source_target_map_developer_name => 'Orders_snow_SalesOrders');
