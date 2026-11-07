/**
 * Delete one configuration version of a retriever. List the versions first to pick the one to drop.
 */

call cdp.retriever_config_list (retriever_id_or_name => 'DIY_Bathroom_Retriever_1Cx_9H02ce17169');

call cdp.retriever_config_delete (
    retriever_id_or_name => 'DIY_Bathroom_Retriever_1Cx_9H02ce17169',
    retriever_configuration_id_or_name => 'DIY_Bathroom_Retriever_v1'
);
