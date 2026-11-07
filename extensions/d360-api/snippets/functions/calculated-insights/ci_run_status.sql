/**
 * Ask Data 360 to refresh the run status of an insight after `ci_run`.
 *
 * The call is not in the spec and its response is undocumented. The path the sample kits use is `ci_get` with `last_run_status`.
 */

call cdp.ci_run (api_name => 'Customer_Order_Summary__cio');

call cdp.ci_run_status (ci_name => 'Customer_Order_Summary__cio');

call cdp.ci_get (api_name => 'Customer_Order_Summary__cio');
