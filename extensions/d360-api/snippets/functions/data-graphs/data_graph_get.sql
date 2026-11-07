/**
 * Read one data graph with its definition, refresh schedule and status.
 *
 * Poll it after create, activate or refresh until `status` is `ready`, and compare without regard to case. `datagraph_metadata` can still say it is in progress while this call says ready. For the graph's records use `datagraph_lookup` or `datagraph_query`.
 */

call cdp.datagraph_metadata (dataspace => 'default');

call cdp.data_graph_get (data_graph_name => 'Customer_Graph');
