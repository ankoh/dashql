/**
 * Step 4 of agent memory.
 *
 * Start a session with its participants.
 */

call cdp.memory_session_create (
    agent_id => 'ACE_Demo_Agent',
    conversation_id => 'conv-2025-001',
    session_id => 'sess-9001',
    conversation_owner_id => '003AB000000XYZ',
    owner_type => 'individual',
    participants => [
        (id = '003AB000000XYZ', type = 'individual', role = 'owner'),
        (id = 'ACE_Demo_Agent', type = 'agent', role = 'participant')
    ]
);
