/**
 * Step 4 of the order pipeline, reads through `SnowflakeConn` of step 3.
 *
 * Read the orders from Snowflake into the data lake object `Orders_snow__dll`.
 */

CALL cdp.datastream_create (
  name => 'Orders_snow',
  label => 'Orders',
  data_stream_type => 'EXTERNAL',
  data_access_mode => 'Direct_Access',
  connector_info => (connector_type = 'DataConnector', connector_details = (name = 'SnowflakeConn')),
  advanced_attributes => (database = 'ANALYTICS', schema = 'PUBLIC', object = 'CUSTOMER_ORDERS'),
  data_lake_object_info => (
    name = 'Orders_snow__dll',
    label = 'Orders',
    category = 'Engagement',
    event_date_time_field_name = 'purchased_at',
    dataspace_info = [(name = 'default')],
    data_lake_field_input_representations = [
      (name = 'order_id', label = 'ORDER_ID', data_type = 'Text', is_primary_key = true),
      (name = 'individual_id', label = 'INDIVIDUAL_ID', data_type = 'Text', is_primary_key = false),
      (name = 'total_amount', label = 'TOTAL_AMOUNT', data_type = 'Number', is_primary_key = false),
      (name = 'purchased_at', label = 'PURCHASED_AT', data_type = 'DateTime', is_primary_key = false)
    ]
  ),
  source_fields => [
    (name = 'ORDER_ID', data_type = 'Text'),
    (name = 'INDIVIDUAL_ID', data_type = 'Text'),
    (name = 'TOTAL_AMOUNT', data_type = 'Number'),
    (name = 'PURCHASED_AT', data_type = 'DateTime')
  ],
  mappings => [
    (source_field_label = 'ORDER_ID', target_field_name = 'order_id', target_field_returntype = 'Text'),
    (source_field_label = 'INDIVIDUAL_ID', target_field_name = 'individual_id', target_field_returntype = 'Text'),
    (source_field_label = 'TOTAL_AMOUNT', target_field_name = 'total_amount', target_field_returntype = 'Number'),
    (source_field_label = 'PURCHASED_AT', target_field_name = 'purchased_at', target_field_returntype = 'DateTime')
  ],
  refresh_config => (refresh_mode = 'TOTAL_REPLACE')
);
