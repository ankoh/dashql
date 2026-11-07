/**
 * Turn a capping configuration on once its dimensions, rules and target mappings are in place, then read it back.
 *
 * Check `success` in the result, not only the HTTP status. This is separate from `is_capping_enabled` on a target.
 */

call cdp.communication_capping_enable (id => '1CCxx0000004C92AAE');

call cdp.communication_capping_configuration_get (id => '1CCxx0000004C92AAE');
