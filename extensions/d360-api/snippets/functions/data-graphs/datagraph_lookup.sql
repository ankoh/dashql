/**
 * Read the record of a data graph for a key, either the primary key of the primary DMO or the one of the Individual linked DMO.
 *
 * `data_graph_entity_name` is the name of the graph, not of a DMO. `lookup_keys` is one string with the brackets included. `no_cache` reads the standard graph instead of the real-time one.
 */

call cdp.datagraph_lookup (
    data_graph_entity_name => 'Customer_Graph',
    dataspace => 'default',
    lookup_keys => '[ssot__Individual__dlm.ssot__Id__c=10000001]',
    no_cache => true
);
