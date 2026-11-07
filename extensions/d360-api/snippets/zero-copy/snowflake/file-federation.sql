/**
 * Read the Iceberg files of a Snowflake table directly: Data 360 takes the file locations from Snowflake Open Catalog and reads the storage with its own compute, so no Snowflake warehouse runs. Take `:connector_type` from the `name` of the Snowflake File Federation connector in the first call. `:snowflake_client_id` and `:snowflake_client_secret` belong to the custom client application in Snowflake.
 *
 * This is a connector of its own, and it has no acceleration: reads are always live. The catalog and the bucket have to be publicly accessible, private connections aren't supported. Iceberg views, V2 merge-on-read deletes, V3 deletion vectors, and the types `time` and `timestamp_ntz` aren't supported. No source gives the API names of the attributes in the second call, `clientId`, `clientSecret` and `catalogUrl` are guesses from the setup page, so check them against the result of `connector_metadata`. Sending a stream of this connector through `Direct_Access` comes from community code. Wait for the connection to be `Active` before creating the stream, and repeat the last call until `status` is `ACTIVE`.
 */

call cdp.connector_list (order_by => 'label ASC');

call cdp.connector_metadata (connector_type => :connector_type);

call cdp.connection_create (
    connector_type => :connector_type,
    label => 'Snowflake files',
    name => 'Snowflake_Files',
    method => 'Ingress',
    credentials => [
        (param_name = 'clientId', value = :snowflake_client_id),
        (param_name = 'clientSecret', value = :snowflake_client_secret)
    ],
    parameters => [(
        param_name = 'catalogUrl',
        value = 'https://my-account.snowflakecomputing.com/polaris/api/catalog'
    )]
);

call cdp.datastream_create (
    name => 'Orders_snowflake_files',
    label => 'Orders (Snowflake files)',
    data_stream_type => 'EXTERNAL',
    data_access_mode => 'Direct_Access',
    connector_info => (connector_type = 'DataConnector', connector_details = (name = 'Snowflake_Files')),
    advanced_attributes => (database = 'ANALYTICS', schema = 'PUBLIC', object = 'CUSTOMER_ORDERS'),
    data_lake_object_info => (
        name = 'Orders_snowflake_files__dll',
        label = 'Orders (Snowflake files)',
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
    refresh_config => (refresh_mode = 'TOTAL_REPLACE')
);

call cdp.datastream_get (record_id_or_developer_name => 'Orders_snowflake_files');
