/**
 * Add a configuration version to a retriever, which is the way to change how it retrieves. This one is an `Ensemble` that combines two retrievers and activates itself.
 *
 * At most one configuration is active at a time. `NoCode` generates its SQL from the configuration and `CustomSql` takes your own.
 */

call cdp.retriever_config_create (
    retriever_id_or_name => 'Combined_Retriever_1Cx_7H01ab12345',
    query_type => 'Ensemble',
    is_active => true,
    number_of_results => 10,
    referenced_retrievers => [
        (name = 'Knowledge_Retriever_1Cx_tGW8aac9aec'),
        (name = 'DIY_Bathroom_Retriever_1Cx_9H02ce17169')
    ]
);

call cdp.retriever_config_list (retriever_id_or_name => 'Combined_Retriever_1Cx_7H01ab12345');
