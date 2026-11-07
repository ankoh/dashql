/**
 * Read one data transform with its definition, schedule and the state of its last run.
 *
 * `status` tells whether the transform is usable (`Active`, `Processing`, `Deleting`, `Error`), while `last_run_status` is about the last run. Compare both case-insensitively.
 */

call cdp.transform_list (order_by => 'NameAsc', limit => 20);

call cdp.transform_get (data_transform_name_or_id => 'account_summary', filter_group => 'Big');
