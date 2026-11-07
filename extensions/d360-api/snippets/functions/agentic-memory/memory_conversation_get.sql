/**
 * Read one conversation with its sessions, entries and metadata, to check what was ingested.
 *
 * `scope` picks the entry types: `messages`, `traces` or `all`. The `sessions` column holds the sessions with their entries as JSON.
 */

call cdp.memory_conversation_get (
    agent_id => 'ACE_Demo_Agent',
    conversation_id => 'conv-2025-001',
    owner_id => '003AB000000XYZ',
    owner_type => 'individual',
    session_id => 'sess-9001',
    scope => 'messages'
);
