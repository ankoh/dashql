/**
 * Assemble the context for the next agent turn from memories, conversation history and profile data, as text for an LLM prompt.
 *
 * The agent ID goes in twice, as the `agent_id` query parameter and in the `ctx_agent_id` header, next to the data space. `fast` is the only mode, so `latency_sensitivity` and `token_budget` have no effect today. Each row of the result is one piece of context with its `source_type`.
 */

call cdp.memory_context_get (
    agent_id => 'ACE_Demo_Agent',
    conversation_id => 'conv-2025-001',
    owner_id => '003AB000000XYZ',
    owner_type => 'individual',
    mode => 'fast',
    ctx_agent_id => 'ACE_Demo_Agent',
    ctx_dataspace_ds_name => 'default'
);
