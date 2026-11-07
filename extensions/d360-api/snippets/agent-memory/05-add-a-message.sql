/**
 * Step 5 of agent memory.
 *
 * Add what was said.
 */

call cdp.memory_entry_add (
    agent_id => 'ACE_Demo_Agent',
    conversation_id => 'conv-2025-001',
    session_id => 'sess-9001',
    entries => [(
        participant_id = '003AB000000XYZ',
        category = 'Message',
        type = 'user_message',
        content = 'How do I reset my password?'
    )]
);
