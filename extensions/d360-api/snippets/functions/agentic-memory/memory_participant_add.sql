/**
 * Bring another participant into an active session, for a handoff to a second agent or several agents working together.
 *
 * The page documents `id`, `type` and `role` of a participant.
 */

call cdp.memory_participant_add (
    agent_id => 'ACE_Demo_Agent',
    conversation_id => 'conv-2025-001',
    session_id => 'sess-9001',
    participants => [
        (id = 'Billing_Agent', type = 'agent', role = 'participant'),
        (id = '005AB000000UVW', type = 'employee', role = 'participant')
    ]
);
