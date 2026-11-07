/**
 * Read one registered agent, to poll its `status` after registering it or to see its configuration.
 *
 * `status` is `Processing`, `Active` or `Error`. `Error` points at the out-of-the-box data graphs. Even `Active` can come a few minutes before the memory calls find the agent.
 */

call cdp.agent_list (limit => 50);

call cdp.agent_get (agent_id_or_api_name => 'support_agent');
