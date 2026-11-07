/**
 * Retry the sync of an activation target that did not finish, then watch its `status`.
 *
 * The spec doesn't say which states it applies to. `status` of `activation_target_get` is the only signal.
 */

call cdp.activation_target_sync_retry (activation_target_id => '85USB000004LBZF2A4');

call cdp.activation_target_get (activation_target_id => '85USB000004LBZF2A4');
