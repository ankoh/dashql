/**
 * Start a batch transform now, outside of its schedule.
 *
 * Only an `Active` batch transform can run. `success` means the run started, not that it finished, so poll `transform_get` until `last_run_status` leaves `Pending` and `InProgress`. A manual run may be forced to a full run, and a run consumes credits.
 */

call cdp.transform_run (data_transform_name_or_id => 'account_summary', should_force_full_run => true);

call cdp.transform_get (data_transform_name_or_id => 'account_summary');

call cdp.transform_run_history_list (data_transform_name_or_id => 'account_summary', limit => 5);
