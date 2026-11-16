/**
 * Step 11 of the order pipeline, needs the active insight of step 10.
 *
 * Run the insight, repeat the second call until `last_run_status` is `SUCCESS`, then read its rows.
 */

call d360.ci_run (api_name => 'Customer_Order_Summary__cio');

call d360.ci_get (api_name => 'Customer_Order_Summary__cio');

call d360.insights_query (ci_name => 'Customer_Order_Summary__cio', batch_size => 10);
