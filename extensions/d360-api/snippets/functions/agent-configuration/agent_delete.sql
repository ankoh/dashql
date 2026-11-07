/**
 * Remove an agent registration that is no longer needed.
 *
 * This deletes the agent's conversations, session history and extracted memories, and can't be undone. Read the agent first to be sure it is the right one.
 */

call cdp.agent_get (agent_id_or_api_name => 'support_agent');

call cdp.agent_delete (agent_id_or_api_name => 'support_agent');
