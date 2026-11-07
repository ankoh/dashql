/**
 * Query a Snowflake table with acceleration: Data 360 caches the rows and refreshes the cache on a schedule, so reads are faster but can be stale. `:snowflake_user` and `:snowflake_private_key` are the credentials, as parameters so that they stay out of the script.
 *
 * Acceleration is a setting of the stream, the connection is the same as for a live query. The cache is a copy with a storage cost, and its schedule can be set from 15 minutes to 7 days. An incremental refresh only upserts, so rows deleted in Snowflake stay in the cache until a full refresh. `incrementalColumn` has to increase monotonically. Wait for the connection to be `Active` before the second call, and repeat the last call until `status` is `ACTIVE`.
 */

call cdp.connection_create (
    connector_type => 'SNOWFLAKE',
    label => 'Snowflake accelerated',
    name => 'Snowflake_Accelerated',
    method => 'Ingress',
    credentials => [
        (param_name = 'authenticationOption', value = 'KeyPair'),
        (param_name = 'user', value = :snowflake_user),
        (param_name = 'privateKey', value = :snowflake_private_key)
    ],
    parameters => [
        (param_name = 'accountUrl', value = 'https://my-account.snowflakecomputing.com'),
        (param_name = 'region', value = 'us-west-2'),
        (param_name = 'warehouse', value = 'QUERY_WH'),
        (param_name = 'unloadData', value = 'true'),
        (param_name = 'hasPrivateNetworkRoute', value = 'false')
    ]
);

call cdp.datastream_create (
    name => 'Orders_snowflake_accelerated',
    label => 'Orders (Snowflake accelerated)',
    data_stream_type => 'EXTERNAL',
    data_access_mode => 'Direct_Access',
    connector_info => (connector_type = 'DataConnector', connector_details = (name = 'Snowflake_Accelerated')),
    advanced_attributes => (
        database = 'ANALYTICS',
        schema = 'PUBLIC',
        object = 'CUSTOMER_ORDERS',
        incrementalColumn = 'PURCHASED_AT'
    ),
    data_lake_object_info => (
        name = 'Orders_snowflake_accelerated__dll',
        label = 'Orders (Snowflake accelerated)',
        category = 'Engagement',
        event_date_time_field_name = 'purchased_at',
        dataspace_info = [(name = 'default')],
        data_lake_field_input_representations = [
            (name = 'order_id', label = 'ORDER_ID', data_type = 'Text', is_primary_key = true),
            (name = 'purchased_at', label = 'PURCHASED_AT', data_type = 'DateTime', is_primary_key = false)
        ]
    ),
    source_fields => [(name = 'ORDER_ID', data_type = 'Text'), (name = 'PURCHASED_AT', data_type = 'DateTime')],
    mappings => [
        (source_field_label = 'ORDER_ID', target_field_name = 'order_id', target_field_returntype = 'Text'),
        (
            source_field_label = 'PURCHASED_AT',
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

call cdp.datastream_get (record_id_or_developer_name => 'Orders_snowflake_accelerated');
