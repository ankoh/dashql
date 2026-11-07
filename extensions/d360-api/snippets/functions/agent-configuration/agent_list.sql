/**
 * List the registered agents, to see what exists in the org and in which state.
 *
 * With no agents registered the list comes back empty, not as an error.
 */

call cdp.agent_list (limit => 50, offset => 0, order_by => 'ASC');

call cdp.agent_get (agent_id_or_api_name => 'support_agent');
