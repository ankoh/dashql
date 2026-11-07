/**
 * List the data actions of a data space with their status, sources and targets.
 *
 * This is the one way to read the status of an action. In the result, `data_action_sources` uses the response spellings such as `objectDevName`, not the names used on create. A new action shows `Processing` before `Active` or `Error`.
 */

call cdp.dataaction_list (dataspace => 'default', batch_size => 50, offset => 0, order_by => 'developer_name');

call cdp.dataaction_get (action_developer_name => 'High_Rate', dataspace => 'default');
