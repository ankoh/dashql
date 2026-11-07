/**
 * List the data graphs with their primary objects, related objects and fields on the tenant host. Use it to find the names a data graph lookup needs.
 *
 * The reference spells the filter `entity_name` in its example and `data_graph_name` in its table, so both exist, and one is enough.
 */

call cdp.direct_datagraph_metadata (entity_name => 'UnifiedIndividual_DG');

call cdp.direct_datagraph_lookup (
    data_graph_entity_name => 'UnifiedIndividual_DG',
    lookup_keys => '[UnifiedLinkssotIndividualIr1__dlm.SourceRecordId__c=10000001]'
);
