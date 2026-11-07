/**
 * Send the messages and traces of a turn to a session, in order, in one call.
 *
 * A `Message` entry carries `content`, a `Trace` entry such as a tool call carries its data in `variable`. Entries are processed in the order received, so send timestamps. The call returns once storage is committed and doesn't wait for extraction. The docs give no idempotency key, so a retry may add the entries twice.
 */

call cdp.memory_entry_add (
    agent_id => 'ACE_Demo_Agent',
    conversation_id => 'conv-2025-001',
    session_id => 'sess-9001',
    entries => [
        (
            participant_id = '003AB000000XYZ',
            category = 'Message',
            type = 'user_message',
            content = 'How do I reset my password?',
            timestamp = '2026-03-02T09:15:00Z'
        ),
        (
            participant_id = 'ACE_Demo_Agent',
            category = 'Trace',
            type = 'tool_call',
            interaction_id = 'int-001',
            variable = (tool = 'kb_search', query = 'password reset'),
            timestamp = '2026-03-02T09:15:02Z'
        ),
        (
            participant_id = 'ACE_Demo_Agent',
            category = 'Message',
            type = 'agent_response',
            content = 'Open Settings, choose Security and select Reset password.',
            timestamp = '2026-03-02T09:15:05Z'
        )
    ]
);
