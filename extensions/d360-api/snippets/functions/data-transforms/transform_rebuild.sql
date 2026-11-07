/**
 * Rebuild a streaming transform so that an edit applies to the data already in the target object, not only to what arrives from now on.
 *
 * Follow the rebuild in the run history: `RebuildPending` and `Rebuilding` come first, then `RebuildSuccess` or `RebuildFailure`. This is a different action from the status refresh.
 */

call cdp.transform_rebuild (data_transform_name_or_id => 'AccountAnon');

call cdp.transform_run_history_list (data_transform_name_or_id => 'AccountAnon', limit => 5);
