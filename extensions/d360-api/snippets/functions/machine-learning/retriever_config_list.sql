/**
 * List all the configuration versions of a retriever. Use it to see which one is active before you activate another.
 */

call cdp.retriever_config_list (
    retriever_id_or_name => 'DIY_Bathroom_Retriever_1Cx_9H02ce17169',
    limit => 50,
    offset => 0
);
