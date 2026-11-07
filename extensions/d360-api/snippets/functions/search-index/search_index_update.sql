/**
 * Change a search index, here its label and description.
 *
 * The spec requires the whole definition in the body, not only the fields that change, and it can't be copied from the read as it is. Read `search_index_config` and the index before, and read the index until `runtime_status` is `READY` after.
 */

call cdp.search_index_update (
    search_index_api_name_or_id => 'Articles_Search',
    label => 'Articles Search v2',
    description => 'Help articles, chunked by passage',
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

call cdp.search_index_get (search_index_api_name_or_id => 'Articles_Search');
