/**
 * Remove a data action, before deleting its target or to recreate it with new settings.
 *
 * This path isn't in the public spec, the only source is a community client, which treats a 404 as already deleted. Read the action first to be sure of the developer name.
 */

call cdp.dataaction_get (action_developer_name => 'High_Rate', dataspace => 'default');

call cdp.dataaction_delete (action_developer_name => 'High_Rate', dataspace => 'default');
