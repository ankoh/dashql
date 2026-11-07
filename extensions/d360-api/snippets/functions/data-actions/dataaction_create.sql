/**
 * Notify a target when rows of a data model object change and pass a condition.
 *
 * The target has to exist and be active. `action_conditions` are numbered with `order`, and `action_condition_expression` combines the numbers. `data_action_projected_fields` picks the fields that go into the event. Creation is asynchronous: read the list until `data_action_status` is `Active` for this `developer_name`, `Error` is final.
 */

call cdp.dataaction_create (
    dataspace => 'default',
    body_dataspace => 'default',
    data_action_target_names => ['contact_webhook'],
    data_action_name => 'High rate',
    developer_name => 'High_Rate',
    description => 'Notify when a rate crosses the threshold',
    master_label => 'High rate',
    data_action_sources => [(
        source_name = 'StaticCurrencyRates_Home__dlm',
        source_type = 'DataModelEntity',
        source_cdc_subscriptions = ['CREATE', 'UPDATE']
    )],
    action_condition_expression => '(1 AND 2)',
    action_conditions => [
        (
            objectName = 'StaticCurrencyRates_Home__dlm',
            fieldName = 'RateDenominatorNumber__c',
            operator = 'GreaterThan',
            order = '1',
            value = '0.3'
        ),
        (
            objectName = 'StaticCurrencyRates_Home__dlm',
            fieldName = 'RateNumeratorNumber__c',
            operator = 'LessThanOrEqualTo',
            order = '2',
            value = '100'
        )
    ],
    data_action_enrichment_properties => [],
    data_action_projected_fields => [(
        objectApiName = 'StaticCurrencyRates_Home__dlm',
        fieldApiName = 'RateNumeratorNumber__c',
        fieldAliasName = 'Rate__c'
    )]
);

call cdp.dataaction_list (dataspace => 'default', batch_size => 50);
