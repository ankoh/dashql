/**
 * Step 8 of the order pipeline, needs `SalesOrders__dlm` of step 6.
 *
 * Declare that an order belongs to an individual. The join of the segment in step 12 relies on this relationship.
 */

call cdp.dmo_relationship_create (
    data_model_object_name => 'SalesOrders__dlm',
    dataspace => 'default',
    relationships => [(
        source_object_name = 'SalesOrders__dlm',
        target_object_name = 'Individuals__dlm',
        source_field_name = 'IndividualId__c',
        target_field_name = 'IndividualId__c',
        cardinality = 'ManyToOne',
        relationship_owner = 'DataCloud'
    )]
);
