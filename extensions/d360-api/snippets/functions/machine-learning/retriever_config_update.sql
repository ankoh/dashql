/**
 * Make a configuration version of a retriever the active one. Activating it deactivates the one that was active.
 *
 * Setting `is_active => false` on the active version deactivates the retriever, which must not be in use by other entities at that point.
 */

call cdp.retriever_config_update (
    retriever_id_or_name => 'DIY_Bathroom_Retriever_1Cx_9H02ce17169',
    retriever_configuration_id_or_name => 'DIY_Bathroom_Retriever_v2',
    is_active => true
);

call cdp.retriever_config_list (retriever_id_or_name => 'DIY_Bathroom_Retriever_1Cx_9H02ce17169');
