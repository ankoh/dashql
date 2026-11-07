/**
 * Mark a conversation complete, which also closes any sessions still open in it.
 *
 * The call answers with HTTP 202. Read the conversation afterwards: its `status` is `COMPLETED` once it's done, a value the docs only show in an example.
 */

call cdp.memory_conversation_get (
    agent_id => 'ACE_Demo_Agent',
    conversation_id => 'conv-2025-001',
    owner_id => '003AB000000XYZ'
);

call cdp.memory_conversation_close (agent_id => 'ACE_Demo_Agent', conversation_id => 'conv-2025-001');

call cdp.memory_conversation_get (
    agent_id => 'ACE_Demo_Agent',
    conversation_id => 'conv-2025-001',
    owner_id => '003AB000000XYZ'
);
