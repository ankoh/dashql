/**
 * End a session, which triggers a last memory extraction for the messages not yet processed.
 *
 * The call answers with HTTP 202 and the docs give no signal for when extraction is done. List the sessions to see the `status` turn `COMPLETED`, then read the memories with `memory_list`.
 */

call cdp.memory_session_close (
    agent_id => 'ACE_Demo_Agent',
    conversation_id => 'conv-2025-001',
    session_id => 'sess-9001'
);

call cdp.memory_session_list (
    agent_id => 'ACE_Demo_Agent',
    conversation_id => 'conv-2025-001',
    owner_id => '003AB000000XYZ',
    owner_type => 'individual'
);
