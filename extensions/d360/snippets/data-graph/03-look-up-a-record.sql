/**
 * Step 3 of the data graph.
 *
 * Read one record through the graph.
 */

call cdp.datagraph_lookup (
    data_graph_entity_name => 'Customer_Graph',
    lookup_keys => '[ssot__Individual__dlm.ssot__Id__c=10000001]'
);
