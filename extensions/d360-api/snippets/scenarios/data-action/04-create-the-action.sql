/**
 * Step 4 of the data action.
 *
 * Call the webhook when a currency rate changes.
 */

call cdp.dataaction_create (
    data_action_target_names => ['contact_webhook'],
    body_dataspace => 'default',
    data_action_name => 'Rate changed',
    developer_name => 'Rate_Changed',
    description => 'Notify on rate changes',
    master_label => 'Rate changed',
    data_action_sources => [(
        source_name = 'StaticCurrencyRates_Home__dlm',
        source_type = 'DataModelEntity',
        source_cdc_subscriptions = ['CREATE', 'UPDATE']
    )],
    action_condition_expression => '',
    action_conditions => [],
    data_action_enrichment_properties => [],
    data_action_projected_fields => []
);
