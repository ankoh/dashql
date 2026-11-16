/**
 * Stop a batch transform that is running right now.
 *
 * Look at the last run first. After the call, `last_run_status` is `Canceled` or `PartiallyCanceled`. `success` in the answer only says that the cancellation started.
 */

call d360.transform_get (data_transform_name_or_id => 'account_summary');

call d360.transform_cancel (data_transform_name_or_id => 'account_summary');

call d360.transform_get (data_transform_name_or_id => 'account_summary');
