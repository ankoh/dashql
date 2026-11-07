/**
 * Get one data graph record by the primary key of the graph's primary DMO. Each item of `data` holds `json_blob__c`, a JSON string with the nested record, so it needs parsing twice.
 *
 * `live` fetches the latest data, which costs more latency and credits and isn't available for real-time graphs.
 */

call cdp.direct_datagraph_get (
    data_graph_entity_name => 'individual_eng_dg',
    id => '100005',
    live => true,
    dataspace => 'default'
);
