/**
 * List the connections of one connector type, sorted by last change, to find the id the other connection calls take.
 *
 * There is no list-all mode, run it once per connector type. The casing of the type is set per connector: `SNOWFLAKE` and `GCS` are upper case, `IngestApi` and `AzureBlob` are mixed case, and a wrong token is rejected. `id`, `name` and `label` of each entry are in the raw result.
 */

call cdp.connection_list (
    connector_type => 'SNOWFLAKE',
    label => 'Snowflake prod',
    order_by => 'last_modified_date',
    limit => 50,
    offset => 0
);

call cdp.connection_get (connection_id => '9cgaj0000012O5hAAE');
