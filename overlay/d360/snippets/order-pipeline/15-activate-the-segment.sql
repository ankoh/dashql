/**
 * Step 15 of the order pipeline, sends the published segment of step 13 to the target of step 14.
 *
 * Take `:activation_id` from the result of the first call to follow its runs.
 */

CALL cdp.activation_create (
  name => 'high_value_s3',
  dataspace_name => 'default',
  segment_api_name => 'High_Value_Order_Buyers',
  activation_target_name => 's3_target',
  refresh_type => 'INCREMENTAL',
  activation_target_subject_config => (developer_name = 'ssot__Individual__dlm'),
  attributes_config => (attributes = [(
    name = 'ssot__Id__c',
    label = 'Individual Id',
    entity_name = 'ssot__Individual__dlm',
    data_source_type = 'Text',
    reference_attribute_name = 'Id',
    source = 'DIRECT',
    type = 'MODEL'
  )])
);
CALL cdp.activation_get (activation_id => :activation_id);
CALL cdp.activation_history_list (activation_id => :activation_id);
