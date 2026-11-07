/**
 * Run the last failed execution of a transform again.
 *
 * The docs don't say which runs are eligible. Read the transform afterwards: the retry is done when `last_run_status` leaves `Pending` and `InProgress`.
 */

call cdp.transform_retry (data_transform_name_or_id => 'account_summary');

call cdp.transform_get (data_transform_name_or_id => 'account_summary');
