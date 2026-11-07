/**
 * Read an access policy with its rules.
 *
 * Take the developer name from the list.
 */

call cdp.access_policy_list (search_string => 'Restrict');

call cdp.access_policy_get (name => 'RestrictSensitiveFields');
