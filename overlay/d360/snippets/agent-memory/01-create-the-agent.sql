/**
 * Step 1 of agent memory.
 *
 * Register the agent. The memory and context calls use its name as `agent_id`.
 */

call cdp.agent_create (name => 'ACE_Demo_Agent', label => 'ACE Demo Agent');
