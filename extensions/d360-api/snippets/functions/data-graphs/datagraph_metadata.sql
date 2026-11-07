/**
 * Read the metadata of one data graph, or leave the name out to list all graphs with their full trees.
 *
 * The spec has no list call for graphs, so this is the list. `developer_name` is the name the other calls take. Each node has its fields, paths and the fragment DMO it uses.
 */

call cdp.datagraph_metadata (data_graph_entity_name => 'Customer_Graph', dataspace => 'default');

call cdp.data_graph_get (data_graph_name => 'Customer_Graph');
