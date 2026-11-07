/**
 * Read a retriever with its latest and its active configuration. Take the top-level `name`, because the name of the active configuration is not accepted here.
 */

call cdp.retriever_list (search => 'Bathroom', detail_level => 'Basic');

call cdp.retriever_get (retriever_id_or_name => 'DIY_Bathroom_Retriever_1Cx_9H02ce17169');
