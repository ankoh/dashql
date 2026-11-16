/**
 * Change the label or description of an access policy.
 *
 * Omitted fields stay as they are. Rules can't change here, use `access_policy_rule_replace` for them.
 */

call d360.access_policy_update (
    name => 'RestrictSensitiveFields',
    label => 'Regional Masking Updated',
    description => 'Updated policy description.'
);
