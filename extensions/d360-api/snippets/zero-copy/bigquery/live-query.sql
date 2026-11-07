/**
 * Query a BigQuery table live: Data 360 sends a query to BigQuery on every read and stores no rows. `:service_account_email` and `:service_account_key` are the credentials, as parameters so that they stay out of the script.
 *
 * `:service_account_key` is the whole JSON key file of the service account, not just its private key. The account needs the roles BigQuery Metadata Viewer, Job User, Data Viewer and Read Session User. `database`, `schema` and `object` hold the project, the dataset and the table. Wait for the connection to be `Active` before the second call, and repeat the last call until `status` is `ACTIVE`.
 */

call cdp.connection_create (
    connector_type => 'BIGQUERY',
    label => 'BigQuery live',
    name => 'BigQuery_Live',
    method => 'Ingress',
    credentials => [
        (param_name = 'authenticationOption', value = 'KeyPair'),
        (param_name = 'serviceAccountEmail', value = :service_account_email),
        (param_name = 'privateKey', value = :service_account_key)
    ],
    parameters => [(param_name = 'projectId', value = 'my-project')]
);

call cdp.datastream_create (
    name => 'Orders_bigquery_live',
    label => 'Orders (BigQuery live)',
    data_stream_type => 'EXTERNAL',
    data_access_mode => 'Direct_Access',
    connector_info => (connector_type = 'DataConnector', connector_details = (name = 'BigQuery_Live')),
    advanced_attributes => (database = 'my-project', schema = 'analytics', object = 'customer_orders'),
    data_lake_object_info => (
        name = 'Orders_bigquery_live__dll',
        label = 'Orders (BigQuery live)',
        category = 'Engagement',
        event_date_time_field_name = 'purchased_at',
        dataspace_info = [(name = 'default')],
        data_lake_field_input_representations = [
            (name = 'order_id', label = 'order_id', data_type = 'Text', is_primary_key = true),
            (name = 'purchased_at', label = 'purchased_at', data_type = 'DateTime', is_primary_key = false)
        ]
    ),
    source_fields => [(name = 'order_id', data_type = 'Text'), (name = 'purchased_at', data_type = 'DateTime')],
    mappings => [
        (source_field_label = 'order_id', target_field_name = 'order_id', target_field_returntype = 'Text'),
        (
            source_field_label = 'purchased_at',
            target_field_name = 'purchased_at',
            target_field_returntype = 'DateTime'
        )
    ],
    refresh_config => (refresh_mode = 'TOTAL_REPLACE')
);

call cdp.datastream_get (record_id_or_developer_name => 'Orders_bigquery_live');
