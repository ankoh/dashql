/**
 * Step 7 of agent memory.
 *
 * Read the context for the next turn of the agent.
 */

call cdp.memory_context_get (
    agent_id => 'ACE_Demo_Agent',
    conversation_id => 'conv-2025-001',
    ctx_agent_id => 'ACE_Demo_Agent',
    ctx_dataspace_ds_name => 'default'
);
