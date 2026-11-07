/**
 * Step 2 of semantic search, uses the options of step 1.
 *
 * Create the hybrid search index `Articles_Search` over the `Body__c` field of `Articles__dlm`.
 */

call cdp.search_index_create (
    label => 'Articles Search',
    developer_name => 'Articles_Search',
    source_dmo_developer_name => 'Articles__dlm',
    chunk_dmo_name => 'Articles Search chunk',
    chunk_dmo_developer_name => 'Articles_Search_chunk',
    vector_dmo_name => 'Articles Search index',
    vector_dmo_developer_name => 'Articles_Search_index',
    search_type => 'HYBRID',
    processing_type => 'NEAR_REALTIME',
    vector_embedding => (
        vector_embedding_related_fields = [(
            related_dmo_developer_name = 'Articles__dlm',
            related_dmo_field_developer_name = 'Id__c',
            relationships = []
        )]
    ),
    chunking_configuration => (
        field_level_configurations = [(
            source_dmo_developer_name = 'Articles__dlm',
            source_dmo_field_developer_name = 'Body__c',
            config = (
                id = 'passage_extraction',
                user_values = [(id = 'strip_html', value = 'true'), (id = 'max_tokens', value = '512')]
            )
        )]
    ),
    vector_embedding_configuration => (
        embedding_model = (
            id = 'e5_large_v2',
            user_values = [(id = 'dimension', value = '1024'), (id = 'max_token_limit', value = '512')]
        ),
        index = (id = 'HNSW', user_values = [(id = 'hnswEfConstruction', value = '2000'), (id = 'M', value = '64')]),
        similarity_metric = 'COSINE'
    )
);
