/**
 * Get data graph records by lookup keys on any DMO of the graph, with only the fields you need and a filter on a related object. Take the DMO and field names from the graph metadata.
 *
 * `lookup_keys` is one string in brackets, and several keys must all match. `fields` are full paths from the root DMO and `filters` apply per DMO. `json_blob__c` holds the nested record as a JSON string.
 */

call cdp.direct_datagraph_lookup (
    data_graph_entity_name => 'UnifiedIndividual_DG',
    lookup_keys => '[UnifiedLinkssotIndividualIr1__dlm.SourceRecordId__c=10000001]',
    fields => '[UnifiedIndividual.ID,UnifiedIndividual.Case.CaseNumber]',
    filters => $$[Case.CreatedDate>='2026-01-01']$$,
    live => false,
    dataspace => 'default'
);
