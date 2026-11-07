/**
 * Read the files of a Databricks table directly: Data 360 takes the file locations from Unity Catalog through its Iceberg REST endpoint and reads the storage with its own compute, so no SQL warehouse runs. Take `:connector_type` from the `name` of the Databricks File Federation connector in the first call. `:databricks_token` is a personal access token, as a parameter so that it stays out of the script.
 *
 * This is a connector of its own, and it has no acceleration: reads are always live. Unity Catalog has to generate Iceberg metadata for each Delta table and allow external data access, workspaces on Hive Metastore aren't supported. The catalog and the bucket have to be publicly accessible. No source gives the API names of the attributes in the second call, `accessToken` and `catalogUrl` are guesses from the setup page, so check them against the result of `connector_metadata`. Sending a stream of this connector through `Direct_Access` comes from community code. Wait for the connection to be `Active` before creating the stream, and repeat the last call until `status` is `ACTIVE`.
 */

call cdp.connector_list (order_by => 'label ASC');

call cdp.connector_metadata (connector_type => :connector_type);

call cdp.connection_create (
    connector_type => :connector_type,
    label => 'Databricks files',
    name => 'Databricks_Files',
    method => 'Ingress',
    credentials => [(param_name = 'accessToken', value = :databricks_token)],
    parameters => [(
        param_name = 'catalogUrl',
        value = 'https://dbc-0123456789.cloud.databricks.com/api/2.1/unity-catalog/iceberg-rest'
    )]
);

call cdp.datastream_create (
    name => 'Orders_databricks_files',
    label => 'Orders (Databricks files)',
    data_stream_type => 'EXTERNAL',
    data_access_mode => 'Direct_Access',
    connector_info => (connector_type = 'DataConnector', connector_details = (name = 'Databricks_Files')),
    advanced_attributes => (database = 'main', schema = 'sales', object = 'customer_orders'),
    data_lake_object_info => (
        name = 'Orders_databricks_files__dll',
        label = 'Orders (Databricks files)',
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

call cdp.datastream_get (record_id_or_developer_name => 'Orders_databricks_files');
