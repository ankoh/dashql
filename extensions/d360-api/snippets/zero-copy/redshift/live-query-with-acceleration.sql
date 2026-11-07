/**
 * Query a Redshift table with acceleration: Data 360 caches the rows and refreshes the cache on a schedule, so reads are faster but can be stale. This also helps when Redshift and Data 360 run in different regions. `:redshift_user` and `:redshift_password` are the credentials, as parameters so that they stay out of the script.
 *
 * Acceleration is a setting of the stream, the connection is the same as for a live query. The cache is a copy with a storage cost, and its schedule can be set from 15 minutes to 7 days. The shape of the stream comes from Snowflake, no source shows one for Redshift. Wait for the connection to be `Active` before the second call, and repeat the last call until `status` is `ACTIVE`.
 */

call cdp.connection_create (
    connector_type => 'REDSHIFT',
    label => 'Redshift accelerated',
    name => 'Redshift_Accelerated',
    method => 'Ingress',
    credentials => [
        (param_name = 'authenticationOption', value = 'usernameAndPassword'),
        (param_name = 'username', value = :redshift_user),
        (param_name = 'password', value = :redshift_password)
    ],
    parameters => [
        (param_name = 'url', value = 'my-cluster.abc123.us-east-1.redshift.amazonaws.com:5439'),
        (param_name = 'database', value = 'analytics'),
        (param_name = 'hasPrivateNetworkRoute', value = 'false')
    ]
);

call cdp.datastream_create (
    name => 'Orders_redshift_accelerated',
    label => 'Orders (Redshift accelerated)',
    data_stream_type => 'EXTERNAL',
    data_access_mode => 'Direct_Access',
    connector_info => (connector_type = 'DataConnector', connector_details = (name = 'Redshift_Accelerated')),
    advanced_attributes => (database = 'analytics', schema = 'public', object = 'customer_orders'),
    data_lake_object_info => (
        name = 'Orders_redshift_accelerated__dll',
        label = 'Orders (Redshift accelerated)',
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

call cdp.datastream_get (record_id_or_developer_name => 'Orders_redshift_accelerated');
