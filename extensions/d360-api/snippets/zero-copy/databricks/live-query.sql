/**
 * Query a Databricks table live: Data 360 sends a query to a SQL warehouse on every read and stores no rows. Take `:authentication_option` from the result of the first call. `:databricks_client_id` and `:databricks_client_secret` are the credentials of a service principal, as parameters so that they stay out of the script.
 *
 * The SQL warehouse must be Pro or Serverless, and clusters need Runtime 13.1 or later. `database` holds the catalog. No source gives the API names of the attributes: `clientId`, `clientSecret`, `url` and `httpPath` are guesses from the setup page, so check them against the first call. The shape of the stream comes from Snowflake, community code says Databricks takes `Direct_Access` as well. Wait for the connection to be `Active` before the third call, and repeat the last call until `status` is `ACTIVE`.
 */

call cdp.connector_metadata (connector_type => 'Databricks');

call cdp.connection_create (
    connector_type => 'Databricks',
    label => 'Databricks live',
    name => 'Databricks_Live',
    method => 'Ingress',
    credentials => [
        (param_name = 'authenticationOption', value = :authentication_option),
        (param_name = 'clientId', value = :databricks_client_id),
        (param_name = 'clientSecret', value = :databricks_client_secret)
    ],
    parameters => [
        (param_name = 'url', value = 'dbc-0123456789.cloud.databricks.com:443'),
        (param_name = 'httpPath', value = '/sql/1.0/warehouses/0123456789abcdef'),
        (param_name = 'hasPrivateNetworkRoute', value = 'false')
    ]
);

call cdp.datastream_create (
    name => 'Orders_databricks_live',
    label => 'Orders (Databricks live)',
    data_stream_type => 'EXTERNAL',
    data_access_mode => 'Direct_Access',
    connector_info => (connector_type = 'DataConnector', connector_details = (name = 'Databricks_Live')),
    advanced_attributes => (database = 'main', schema = 'sales', object = 'customer_orders'),
    data_lake_object_info => (
        name = 'Orders_databricks_live__dll',
        label = 'Orders (Databricks live)',
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

call cdp.datastream_get (record_id_or_developer_name => 'Orders_databricks_live');
