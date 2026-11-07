/**
 * Enable an insight so that segments and activations can use it.
 *
 * This call comes from Salesforce's MCP server and is not in the spec, so the response stays raw in `_raw`. `is_enabled` of `ci_get` is the spec's field for the state.
 */

call cdp.ci_enable (ci_name => 'Customer_Order_Summary__cio');

call cdp.ci_get (api_name => 'Customer_Order_Summary__cio');
