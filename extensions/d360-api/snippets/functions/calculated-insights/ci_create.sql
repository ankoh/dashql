/**
 * Define a calculated insight that adds up the order amount per customer and recompute it every six hours.
 *
 * The SQL is restricted: qualify the columns with the table, group by the qualified names and not by aliases, and use `APPROX_COUNT_DISTINCT` instead of `COUNT(DISTINCT ...)`. The call can take 30 to 60 seconds, and it fails with `Error getting FactTable` until the mappings of the source objects have processed data. Wait for `calculated_insight_status` to be `ACTIVE` before you run it.
 */

call cdp.ci_create (
    api_name => 'Customer_Order_Summary__cio',
    display_name => 'Customer Order Summary',
    description => 'Total order amount per customer.',
    definition_type => 'CALCULATED_METRIC',
    dataspace_name => 'default',
    publish_schedule_interval => 'Six',
    publish_schedule_start_date_time => '2026-12-01T06:00',
    expression => $$
        SELECT Order__dlm.CustomerId__c AS customer_id__c, SUM(Order__dlm.Total__c) AS total__c, COUNT(Order__dlm.OrderId__c) AS order_count__c
        FROM Order__dlm
        GROUP BY Order__dlm.CustomerId__c
    $$
);

call cdp.ci_get (api_name => 'Customer_Order_Summary__cio');
