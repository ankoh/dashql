/**
 * Read one configuration version of a retriever with its query type, output fields, filters and citation settings. The active configuration is the one the retriever uses at runtime.
 */

call cdp.retriever_config_list (retriever_id_or_name => 'DIY_Bathroom_Retriever_1Cx_9H02ce17169');

call cdp.retriever_config_get (
    retriever_id_or_name => 'DIY_Bathroom_Retriever_1Cx_9H02ce17169',
    retriever_configuration_id_or_name => 'DIY_Bathroom_Retriever_v1'
);
