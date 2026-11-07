/**
 * Overwrite the one rule of an access policy, here a mask on the first four characters of a field.
 *
 * It is a full overwrite, so read the rule first. `rule_name` in the path and `body_name` must be equal or the call returns `NAME_MISMATCH`. `rule_consumer` limits which product enforces it.
 */

call cdp.access_policy_rule_get (name => 'RestrictSensitiveFields', rule_name => 'Mask_SSN');

call cdp.access_policy_rule_replace (
    name => 'RestrictSensitiveFields',
    rule_name => 'Mask_SSN',
    body_name => 'Mask_SSN',
    label => 'Mask SSN',
    category => 'TRANSFORM_POLICY_RULE_DEFINITION',
    effect => 'Transform',
    action => ['Read'],
    resource_scope_type => 'FIELD',
    principal_scope_type => 'ANY',
    resource_domains => ['Account__dlm'],
    resource_transform => 'FIRST_N_CHARS_RESOURCE_TRANSFORM',
    resource_transform_arguments => [(type = 'NUMBER', value = '4')],
    transform_precedence => 100,
    rule_consumer => 'DATACLOUD'
);
