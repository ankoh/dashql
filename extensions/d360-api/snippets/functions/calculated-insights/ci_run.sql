/**
 * Compute an insight now, outside of its schedule.
 *
 * `success` only says the run was initiated. Poll `ci_get` until `last_run_status` is `SUCCESS`, and run one insight at a time. Runs are billable.
 */

call d360.ci_run (api_name => 'Customer_Order_Summary__cio');

call d360.ci_get (api_name => 'Customer_Order_Summary__cio');
