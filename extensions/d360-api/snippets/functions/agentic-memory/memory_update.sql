/**
 * Replace the content of existing memory entries, each picked by its memory ID.
 *
 * The docs say an update creates a new memory ID, yet show the old one in the response. Take the ID from the result.
 */

call cdp.memory_list (
    profile_id => '003AB000000XYZ',
    profile_type => 'individual',
    category => 'sys_PROFILE_PREFERENCES'
);

call cdp.memory_update (
    agent_id => 'ACE_Demo_Agent',
    profile_id => '003AB000000XYZ',
    profile_type => 'individual',
    category => 'sys_PROFILE_PREFERENCES',
    memories => [
        (memory_id = 'mem_abc123', content = 'Prefers PST scheduling'),
        (memory_id = 'mem_abc124', content = 'Wants order updates by email and SMS')
    ]
);
