/**
 * Query a BigQuery table with acceleration: Data 360 caches the rows and refreshes the cache on a schedule, so reads are faster but can be stale. `:service_account_email` and `:service_account_key` are the credentials, as parameters so that they stay out of the script.
 *
 * Acceleration is a setting of the stream, the connection is the same as for a live query. BigQuery only takes an `INCREMENTAL` refresh with acceleration on. An incremental refresh only upserts, so rows deleted in BigQuery stay in the cache until a full refresh. The cache is a copy with a storage cost, and its schedule can be set from 15 minutes to 7 days. Wait for the connection to be `Active` before the second call, and repeat the last call until `status` is `ACTIVE`.
 */

call cdp.connection_create (
    connector_type => 'BIGQUERY',
    label => 'BigQuery accelerated',
    name => 'BigQuery_Accelerated',
    method => 'Ingress',
    credentials => [
        (param_name = 'authenticationOption', value = 'KeyPair'),
        (param_name = 'serviceAccountEmail', value = :service_account_email),
        (param_name = 'privateKey', value = :service_account_key)
    ],
    parameters => [(param_name = 'projectId', value = 'my-project')]
);

call cdp.datastream_create (
    name => 'Orders_bigquery_accelerated',
    label => 'Orders (BigQuery accelerated)',
    data_stream_type => 'EXTERNAL',
    data_access_mode => 'Direct_Access',
    connector_info => (connector_type = 'DataConnector', connector_details = (name = 'BigQuery_Accelerated')),
    advanced_attributes => (
        database = 'my-project',
        schema = 'analytics',
        object = 'customer_orders',
        incrementalColumn = 'purchased_at'
    ),
    data_lake_object_info => (
        name = 'Orders_bigquery_accelerated__dll',
        label = 'Orders (BigQuery accelerated)',
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
        refresh_mode = 'INCREMENTAL',
        is_acceleration_enabled = true,
        frequency = (frequency_type = 'DAILY', hours = [6])
    )
);

call cdp.datastream_get (record_id_or_developer_name => 'Orders_bigquery_accelerated');
