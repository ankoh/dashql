/**
 * Remove memory entries for good, by memory ID.
 *
 * Read the category first to pick the IDs. The profile and category options are required although each entry is identified by its ID.
 */

call cdp.memory_list (
    profile_id => '003AB000000XYZ',
    profile_type => 'individual',
    category => 'sys_PROFILE_PREFERENCES'
);

call cdp.memory_delete (
    profile_id => '003AB000000XYZ',
    profile_type => 'individual',
    category => 'sys_PROFILE_PREFERENCES',
    memories => [(memory_id = 'mem_abc123'), (memory_id = 'mem_abc124')]
);
