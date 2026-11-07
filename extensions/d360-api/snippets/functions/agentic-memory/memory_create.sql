/**
 * Write memory entries to a profile by hand, next to what extraction produces. Each entry gets a memory ID from the system.
 *
 * Entries land in the `category` partition, such as `sys_PROFILE_PREFERENCES` or `sys_PROFILE_FACT`. The result lists the new IDs. This call and `memory_update` send the same verb and path, and the response `status_code` shows which one ran.
 */

call cdp.memory_create (
    agent_id => 'ACE_Demo_Agent',
    profile_id => '003AB000000XYZ',
    profile_type => 'individual',
    category => 'sys_PROFILE_PREFERENCES',
    memories => [(content = 'Prefers EST scheduling'), (content = 'Wants order updates by email, not SMS')]
);

call cdp.memory_list (
    profile_id => '003AB000000XYZ',
    profile_type => 'individual',
    category => 'sys_PROFILE_PREFERENCES'
);
