/**
 * Remove a data share target that nothing uses any more.
 *
 * Unlink the shares from it first with `data_share_unlink`, the help pages describe deleting only unlinked ones. Read the target before to be sure of the name, and again afterwards: the status enum has `Deleting`, and the spec doesn't say whether the call waits.
 */

call cdp.data_share_target_get (name_or_id => 'BigQuery_Analytics_Target');

call cdp.data_share_target_delete (name_or_id => 'BigQuery_Analytics_Target');
