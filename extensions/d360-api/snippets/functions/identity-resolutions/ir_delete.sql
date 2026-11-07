/**
 * Delete an identity resolution ruleset you no longer use.
 *
 * Use the `id` from the list, not a name, because rulesets have no developer name. Active resolutions may be affected, and no source says what happens to the DMOs the ruleset generated. `ruleset_status` can show `DELETING` or `DELETE_FAILED`, so read the ruleset afterwards.
 */

call cdp.ir_get (identity_resolution => '1irfj000000IWhWAAW');

call cdp.ir_delete (identity_resolution => '1irfj000000IWhWAAW');
