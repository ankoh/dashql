/**
 * Read the memory entries a profile holds in one category, whether extraction or a person put them there.
 *
 * Use it to look up the `memory_id` an update or delete needs. The call has no paging.
 */

call cdp.memory_list (
    agent_id => 'ACE_Demo_Agent',
    profile_id => '003AB000000XYZ',
    profile_type => 'individual',
    category => 'sys_PROFILE_FACT'
);
