/**
 * Show the finished runs of a transform, with duration, end time and the state per output object.
 *
 * Page with `limit` and `offset`, and stop on `total_size` or a short page. A run with nothing to do shows as `SkippedNoChanges`. A job in progress doesn't show here reliably, so watch it with `transform_get`.
 */

call cdp.transform_run_history_list (data_transform_name_or_id => 'account_summary', limit => 20, offset => 0);
