/**
 * Read one rule of an access policy, to see how it permits, forbids or masks.
 *
 * Reading it first is also what you want before replacing it.
 */

call cdp.access_policy_get (name => 'RestrictSensitiveFields');

call cdp.access_policy_rule_get (name => 'RestrictSensitiveFields', rule_name => 'Mask_SSN');
