/**
 * Remove an access policy for good, together with its rules.
 *
 * Read the policy first to see which rule goes with it. The delete is accepted with no body and no rows come back.
 */

call cdp.access_policy_get (name => 'RestrictSensitiveFields');

call cdp.access_policy_delete (name => 'RestrictSensitiveFields');
