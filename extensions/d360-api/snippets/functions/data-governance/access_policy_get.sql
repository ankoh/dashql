/**
 * Read an access policy with its rules.
 *
 * Take the developer name from the list.
 */

call d360.access_policy_list (search_string => 'Restrict');

call d360.access_policy_get (name => 'RestrictSensitiveFields');
