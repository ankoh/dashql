/**
 * List the sessions of a conversation as summary rows, without entries.
 *
 * Use it to find a session ID, or to see which sessions are still `ACTIVE` and which are `COMPLETED`. The ID comes back as `id` here and as `session_id` in the conversation read.
 */

call cdp.memory_session_list (
    agent_id => 'ACE_Demo_Agent',
    conversation_id => 'conv-2025-001',
    owner_id => '003AB000000XYZ',
    owner_type => 'individual',
    status => 'ACTIVE',
    participant_id => 'ACE_Demo_Agent'
);
