/**
 * Create an access policy with the one rule the policy builder allows, here one that masks all but the first four characters of a field.
 *
 * A second rule is refused with `MULTIPLE_RULES_NOT_ALLOWED`. The rule has an effect (`Permit`, `Forbid` or `Transform`) and a category, and a Transform rule takes a transform with its arguments. When several Transform rules apply to a field, the lower `transform_precedence` wins.
 */

call cdp.access_policy_create (
    name => 'RestrictSensitiveFields',
    label => 'Restrict Sensitive Fields',
    description => 'Restricts read access to sensitive account fields.',
    dataspace_name => 'default',
    rules => [(
        name = 'Mask_SSN',
        label = 'Mask SSN',
        category = 'TRANSFORM_POLICY_RULE_DEFINITION',
        effect = 'Transform',
        action = ['Read'],
        resource_scope_type = 'FIELD',
        principal_scope_type = 'ANY',
        resource_domains = ['Account__dlm'],
        resource_transform = 'FIRST_N_CHARS_RESOURCE_TRANSFORM',
        resource_transform_arguments = [(type = 'NUMBER', value = '4')],
        transform_precedence = 100
    )]
);

call cdp.access_policy_get (name => 'RestrictSensitiveFields');
