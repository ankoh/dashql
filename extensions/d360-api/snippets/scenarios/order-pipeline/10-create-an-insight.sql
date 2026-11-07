/**
 * Step 10 of the order pipeline, reads `SalesOrders__dlm` of step 6.
 *
 * Compute the total order amount per individual. Repeat the last call until `calculated_insight_status` is `ACTIVE`.
 */

call cdp.ci_create (
    api_name => 'Customer_Order_Summary__cio',
    display_name => 'Customer Order Summary',
    description => 'Total order amount per individual.',
    definition_type => 'CALCULATED_METRIC',
    dataspace_name => 'default',
    publish_schedule_interval => 'Six',
    publish_schedule_start_date_time => '2027-01-01T06:00',
    expression => $$
    SELECT SalesOrders__dlm.IndividualId__c AS customer_id__c, SUM(SalesOrders__dlm.TotalAmount__c) AS total__c
    FROM SalesOrders__dlm
    GROUP BY SalesOrders__dlm.IndividualId__c
  $$
);

call cdp.ci_get (api_name => 'Customer_Order_Summary__cio');
