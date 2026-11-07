/**
 * Retire a capping rule before its end date passes. List the rules of the configuration first to get the id.
 *
 * Delete is the one rule call whose path has no configuration id. The sources don't say which name works besides the id.
 */

call cdp.communication_capping_rule_list (id => '1CCxx0000004C92AAE', limit => 50);

call cdp.communication_capping_rule_delete (rule_id_or_name => 'Email_daily');
