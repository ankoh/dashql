/**
 * Declare that each order belongs to one individual, so queries can join the two.
 *
 * Both DMOs need mappings first, otherwise the call fails with `No ObjectSourceTargetMaps were found`. A relationship that already exists is skipped. A new one starts as `CREATING`, so find it by its name in the list until it is `ACTIVE`.
 */

call cdp.dmo_relationship_create (
    data_model_object_name => 'SalesOrders__dlm',
    dataspace => 'default',
    relationships => [(
        source_object_name = 'SalesOrders__dlm',
        target_object_name = 'ssot__Individual__dlm',
        source_field_name = 'IndividualId__c',
        target_field_name = 'ssot__Id__c',
        cardinality = 'ManyToOne',
        relationship_owner = 'DataCloud'
    )]
);

call cdp.dmo_relationship_list (data_model_object_name => 'SalesOrders__dlm', dataspace => 'default');
