/**
 * Create a retriever over a search index, with its first configuration, so AI features can query it. The search index needs a `runtime_status` of `READY`.
 *
 * Retrying this call creates a duplicate. Look up the label with `retriever_list` before you retry. Each output field names the chunk object it reads, and the relationships join it back to the source object.
 */

call cdp.retriever_create (
    label => 'DIY Bathroom Retriever',
    description => 'Finds passages of the DIY bathroom guides.',
    owner_type => 'Api',
    dataspaces => ['default'],
    configuration => (
        query_type = 'NoCode',
        is_active = true,
        number_of_results = 10,
        input = (name = 'DIY_Bathroom', type = 'SearchIndex'),
        output_fields = [(
            label = 'Chunk',
            relatedDmoName = 'DIY_Bathroom_chunk__dlm',
            relatedDmoFieldName = 'Chunk__c',
            relationships = [(
                relationSourceDmoName = 'DIY_Bathroom_chunk__dlm',
                relationSourceDmoFieldName = 'SourceRecordId__c',
                relationTargetDmoName = 'DIY_Bathroom__dlm',
                relationTargetDmoFieldName = 'FilePath__c'
            )]
        )]
    )
);

call cdp.retriever_list (search => 'DIY Bathroom', detail_level => 'Basic');
