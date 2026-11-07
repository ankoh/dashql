/**
 * Find the conversations of one person with an agent, as summary rows without sessions or entries.
 *
 * Reach for it to look up a `conversation_id`. Filters narrow the list by status and participant, and `fields` limits the columns the API returns.
 */

call cdp.memory_conversation_list (
    agent_id => 'ACE_Demo_Agent',
    owner_id => '003AB000000XYZ',
    owner_type => 'individual',
    status => 'ACTIVE',
    participant_id => 'ACE_Demo_Agent',
    fields => ['id', 'name', 'startTime']
);
