/**
 * Start a conversation for an agent and the person it talks to, with an ID you choose.
 *
 * The sessions and entries of the conversation go inside it. The docs list no error for a duplicate `conversation_id`, so pick a fresh one.
 */

call cdp.memory_conversation_create (
    agent_id => 'ACE_Demo_Agent',
    conversation_id => 'conv-2025-001',
    conversation_owner_id => '003AB000000XYZ',
    owner_type => 'individual',
    name => 'Support, onboarding',
    channel => (type = 'chat', id = 'slack-C0123'),
    variable => (topic = 'onboarding', priority = 'high')
);
