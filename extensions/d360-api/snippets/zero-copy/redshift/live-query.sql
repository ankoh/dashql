/**
 * Query a Redshift table live: Data 360 sends a query to Redshift on every read and stores no rows. `:redshift_user` and `:redshift_password` are the credentials, as parameters so that they stay out of the script.
 *
 * The cluster or workgroup has to be publicly accessible, unless the connection uses a private network route, which can't be added to an existing connection. For large tables, set the maximum query execution time of Redshift to its maximum of 86,399 seconds. The shape of the stream comes from Snowflake, no source shows one for Redshift. Wait for the connection to be `Active` before the second call, and repeat the last call until `status` is `ACTIVE`.
 */

call cdp.connection_create (
    connector_type => 'REDSHIFT',
    label => 'Redshift live',
    name => 'Redshift_Live',
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
    name => 'Orders_redshift_live',
    label => 'Orders (Redshift live)',
    data_stream_type => 'EXTERNAL',
    data_access_mode => 'Direct_Access',
    connector_info => (connector_type = 'DataConnector', connector_details = (name = 'Redshift_Live')),
    advanced_attributes => (database = 'analytics', schema = 'public', object = 'customer_orders'),
    data_lake_object_info => (
        name = 'Orders_redshift_live__dll',
        label = 'Orders (Redshift live)',
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

call cdp.datastream_get (record_id_or_developer_name => 'Orders_redshift_live');
