/**
 * Read when a transform runs on its own.
 *
 * The result fields depend on the frequency, so read `interval`, `days_of_week` and `time` from `_raw`. Streaming transforms run continually and have no schedule.
 */

call cdp.transform_get (data_transform_name_or_id => 'account_summary');

call cdp.transform_schedule_get (data_transform_name_or_id => 'account_summary');
