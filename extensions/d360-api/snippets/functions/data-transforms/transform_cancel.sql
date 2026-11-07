/**
 * Stop a batch transform that is running right now.
 *
 * Look at the last run first. After the call, `last_run_status` is `Canceled` or `PartiallyCanceled`. `success` in the answer only says that the cancellation started.
 */

call cdp.transform_get (data_transform_name_or_id => 'account_summary');

call cdp.transform_cancel (data_transform_name_or_id => 'account_summary');

call cdp.transform_get (data_transform_name_or_id => 'account_summary');
