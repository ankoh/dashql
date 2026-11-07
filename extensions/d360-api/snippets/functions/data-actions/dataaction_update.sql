/**
 * Try to change a data action by its developer name.
 *
 * No public source documents this call or its body, so it takes no other options. To change an action, delete it and create it again.
 */

call cdp.dataaction_get (action_developer_name => 'High_Rate', dataspace => 'default');

call cdp.dataaction_update (action_developer_name => 'High_Rate');
