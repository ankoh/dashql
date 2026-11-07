/**
 * Raise or lower a cap and move its date window without recreating the rule.
 *
 * Send the fields that change. The rule is addressed by the configuration id and the rule id or name.
 */

call cdp.communication_capping_rule_update (
    id => '1CCxx0000004C92AAE',
    rule_id_or_name => 'Email_daily',
    limits => 5,
    start_date => '2026-06-01T00:00:00Z',
    end_date => '2026-06-30T00:00:00Z'
);

call cdp.communication_capping_rule_list (id => '1CCxx0000004C92AAE', limit => 50);
