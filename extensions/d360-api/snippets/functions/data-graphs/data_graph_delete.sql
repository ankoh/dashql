/**
 * Delete a data graph that nothing needs any more.
 *
 * Read it first. No source says what happens to the system DMOs and the transform the graph created, or to objects that reference it, such as personalization points, so compare the metadata before and after. The spec has no data space option here.
 */

call cdp.data_graph_get (data_graph_name => 'Customer_Graph');

call cdp.data_graph_delete (data_graph_name => 'Customer_Graph');
