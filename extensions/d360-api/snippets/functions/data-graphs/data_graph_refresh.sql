/**
 * Rebuild the materialized data of a data graph now, outside its schedule.
 *
 * Check `success` in the result: a refusal such as `DG_REFRESH_NOT_ALLOWED` comes back as `success = false`. There is no documented completion signal, so read the graph and watch `status` and `last_run_status`.
 */

call cdp.data_graph_refresh (data_graph_name => 'Customer_Graph');

call cdp.data_graph_get (data_graph_name => 'Customer_Graph');
