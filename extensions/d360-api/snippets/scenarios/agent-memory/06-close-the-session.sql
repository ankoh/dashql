/**
 * Step 6 of agent memory.
 *
 * Close the session.
 */

call d360.memory_session_close (
    agent_id => 'ACE_Demo_Agent',
    conversation_id => 'conv-2025-001',
    session_id => 'sess-9001'
);
