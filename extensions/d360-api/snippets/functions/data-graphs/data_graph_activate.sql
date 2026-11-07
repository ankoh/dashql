/**
 * Build a data graph that was saved as a draft, which starts its materialization job. It matches Save and Build in the UI.
 *
 * `success = true` only means the action started: read the graph until `status` is `ready`. The schedule here is a full refresh every day. This is for drafts, which a graph created with `creation_mode` set to `draft` is.
 */

call cdp.data_graph_activate (
    data_graph_name => 'Customer_Graph',
    full_refresh_config => (schedule = (frequency = 1, time_granularity = 'Day'))
);

call cdp.data_graph_get (data_graph_name => 'Customer_Graph');
