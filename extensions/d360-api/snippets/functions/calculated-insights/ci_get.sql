/**
 * Read one calculated insight to see whether its definition is usable and how the last run went.
 *
 * `calculated_insight_status` is `ACTIVE` once the definition compiled, and `last_run_status` is `SUCCESS` after a finished run. An `ACTIVE` insight with no `last_run_status` is normal before the first run.
 */

call cdp.ci_list (offset => 0, definition_type => 'CALCULATED_METRIC');

call cdp.ci_get (api_name => 'Customer_Order_Summary__cio');
