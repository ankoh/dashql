/**
 * Fill the cache of an accelerated BigQuery stream by unloading: on a refresh, BigQuery runs the query of Data 360 and exports the result to a temporary Cloud Storage bucket, and Data 360 reads and caches it. `:service_account_email` and `:service_account_key` are the credentials, as parameters so that they stay out of the script.
 *
 * Unloading is a setting of the connection and only affects accelerated streams. It needs a bucket that the service account can use with the role Storage Object User, and a temporary dataset whose tables expire after six hours. No source gives the API names of these settings: `unloadData` comes from the Snowflake connector, and `gcsBucket` and `temporaryDataset` are guesses, so check all three against the result of the first call. Wait for the connection to be `Active` before the third call, and repeat the last call until `status` is `ACTIVE`.
 */

call cdp.connector_metadata (connector_type => 'BIGQUERY');

call cdp.connection_create (
    connector_type => 'BIGQUERY',
    label => 'BigQuery unload',
    name => 'BigQuery_Unload',
    method => 'Ingress',
    credentials => [
        (param_name = 'authenticationOption', value = 'KeyPair'),
        (param_name = 'serviceAccountEmail', value = :service_account_email),
        (param_name = 'privateKey', value = :service_account_key)
    ],
    parameters => [
        (param_name = 'projectId', value = 'my-project'),
        (param_name = 'unloadData', value = 'true'),
        (param_name = 'gcsBucket', value = 'data360-unload'),
        (param_name = 'temporaryDataset', value = 'data360_unload_tmp')
    ]
);

call cdp.datastream_create (
    name => 'Orders_bigquery_unload',
    label => 'Orders (BigQuery unload)',
    data_stream_type => 'EXTERNAL',
    data_access_mode => 'Direct_Access',
    connector_info => (connector_type = 'DataConnector', connector_details = (name = 'BigQuery_Unload')),
    advanced_attributes => (database = 'my-project', schema = 'analytics', object = 'customer_orders'),
    data_lake_object_info => (
        name = 'Orders_bigquery_unload__dll',
        label = 'Orders (BigQuery unload)',
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
    refresh_config => (
        refresh_mode = 'TOTAL_REPLACE',
        is_acceleration_enabled = true,
        frequency = (frequency_type = 'DAILY', hours = [6])
    )
);

call cdp.datastream_get (record_id_or_developer_name => 'Orders_bigquery_unload');
