/**
 * Read one data kit by its developer name.
 *
 * This call comes from Salesforce's MCP server and is not in the public spec, so the response is left raw in `_raw`. Use the list or the manifest when you need a documented response.
 */

call cdp.datakit_list (namespace => 'acme');

call cdp.datakit_get (data_kit_dev_name => 'Customer_Kit');
