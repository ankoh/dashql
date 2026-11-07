/**
 * Read the record of a data graph by the id of its primary object.
 *
 * It is a get by key and takes no SQL. For any other key use `datagraph_lookup`. With `live` the latest data is read instead of the precalculated one, at a longer latency and higher credit use, and not for real-time graphs.
 */

call cdp.datagraph_query (
    data_graph_entity_name => 'Customer_Graph',
    id => '10000001',
    dataspace => 'default',
    live => true
);
