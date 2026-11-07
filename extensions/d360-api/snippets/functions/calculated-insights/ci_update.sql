/**
 * Change the description and the refresh schedule of an insight, here to every 12 hours.
 *
 * The name must end in `__cio`. An update triggers a recompilation. The spec shares its input schema with create and marks the schedule interval and start as required, so send both.
 */

call cdp.ci_update (
    api_name => 'Customer_Order_Summary__cio',
    description => 'Total order amount per customer, refreshed twice a day.',
    publish_schedule_interval => 'Twelve',
    publish_schedule_start_date_time => '2026-12-01T06:00',
    publish_schedule_end_date => '2026-12-31'
);

call cdp.ci_get (api_name => 'Customer_Order_Summary__cio');
