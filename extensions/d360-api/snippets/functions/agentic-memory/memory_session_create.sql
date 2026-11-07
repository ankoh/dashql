/**
 * Open a session inside a conversation, with an ID you choose and at least one participant.
 *
 * `conversation_owner_id` must match the parent conversation. Reads are limited to participants, so list the agent as a participant as well as the person.
 */

call cdp.memory_session_create (
    agent_id => 'ACE_Demo_Agent',
    conversation_id => 'conv-2025-001',
    session_id => 'sess-9001',
    conversation_owner_id => '003AB000000XYZ',
    owner_type => 'individual',
    participants => [
        (id = '003AB000000XYZ', type = 'individual', role = 'owner', start_time = '2026-03-02T09:14:00Z'),
        (id = 'ACE_Demo_Agent', type = 'agent', role = 'participant', start_time = '2026-03-02T09:14:00Z')
    ],
    variable => (source = 'web_widget')
);
