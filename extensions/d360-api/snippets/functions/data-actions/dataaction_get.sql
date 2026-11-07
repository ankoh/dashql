/**
 * Inspect one data action by its developer name, with its conditions, sources and targets.
 *
 * This path isn't in the public spec, it comes from Salesforce's MCP source. If it fails in your org, page the list instead.
 */

call cdp.dataaction_list (dataspace => 'default', batch_size => 50);

call cdp.dataaction_get (action_developer_name => 'High_Rate', dataspace => 'default');
