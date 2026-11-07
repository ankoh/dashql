/**
 * Run a transform every day at 02:00 Los Angeles time.
 *
 * `frequency` takes `Daily`, `Hourly` or `None`, and `None` clears the schedule. Without `should_force_specified_minutes` the platform spreads runs over the hour, so the minute isn't exact. The docs mark `time` required even for `None`.
 */

call cdp.transform_schedule_set (
    data_transform_name_or_id => 'account_summary',
    frequency => 'Daily',
    time => (hour = 2, minute = 0, time_zone = 'America/Los_Angeles'),
    should_force_specified_minutes => true
);

call cdp.transform_schedule_get (data_transform_name_or_id => 'account_summary');
