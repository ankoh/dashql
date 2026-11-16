/**
 * Change the label and the description of a retriever. To change how it retrieves, create a new configuration version instead.
 */

call d360.retriever_update (
    retriever_id_or_name => 'DIY_Bathroom_Retriever_1Cx_9H02ce17169',
    label => 'DIY Bathroom Retriever',
    description => 'A NoCode retriever over the DIY bathroom search index.'
);

call d360.retriever_get (retriever_id_or_name => 'DIY_Bathroom_Retriever_1Cx_9H02ce17169');
