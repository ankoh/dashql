/**
 * Change the label, the schedule and the reconciliation rules of a ruleset.
 *
 * The spec requires `label` and `reconciliation_rules` in every update, so send both even for a small change. Read the ruleset afterwards to see what the server kept.
 */

call cdp.ir_update (
    identity_resolution => '1irfj000000IWhWAAW',
    label => 'Customer Match',
    description => 'Email, or name plus phone, or device serial number',
    does_run_automatically => true,
    reconciliation_rules => [
        (entity_name = 'ssot__Individual__dlm', rule_type = 'lastupdated', should_ignore_empty_value = true),
        (entity_name = 'ssot__ContactPointEmail__dlm', rule_type = 'mostfrequent', should_ignore_empty_value = true)
    ]
);

call cdp.ir_get (identity_resolution => '1irfj000000IWhWAAW');
