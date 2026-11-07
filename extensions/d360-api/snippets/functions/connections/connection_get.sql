/**
 * Read one connection with its settings and status. The fields depend on the connector type, a `StreamingApp` answers differently from a `SalesforceMarketingCloud` connection.
 *
 * Credentials come back masked. `id`, `name` and `label` are in the raw result.
 */

call cdp.connection_list (connector_type => 'SNOWFLAKE', order_by => 'label');

call cdp.connection_get (connection_id => '9cgaj0000012O5hAAE');
