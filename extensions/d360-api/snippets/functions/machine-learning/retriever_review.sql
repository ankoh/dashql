/**
 * Check the SQL of a `CustomSql` retriever before you create it. The review returns errors and suggestions, so a bad template shows up here and not in a retriever you then have to delete.
 *
 * The template is written verbatim between `$$`, with its placeholders declared next to it. `existing_retriever_asset` names the retriever the new configuration is reviewed against.
 */

call cdp.retriever_review (
    retriever_input => (
        label = 'Knowledge CustomSql Retriever',
        description = 'Finds knowledge article chunks in the online publication status.',
        owner_type = 'Api',
        dataspaces = ['default'],
        configuration = (
            query_type = 'CustomSql',
            is_active = true,
            number_of_results = 5,
            is_citation_enabled = false,
            retrieval_mode = 'Basic',
            retriever_query_template_definition = (
                retriever_query_template = $$SELECT
    "v"."hybrid_score__c" AS "Score",
    "c"."Chunk__c" AS "Chunk",
    "c"."SourceRecordId__c" AS "SourceRecordId"
FROM
    hybrid_search(
    TABLE("KA_kav_index__dlm"),
    :"SearchString",
    'Language__c = :"Language" AND KnowledgePublicationStatus__c = ''Online''',
    :"NumOfResults"
    ) AS "v"
    INNER JOIN "KA_kav_chunk__dlm" AS "c" ON "c"."RecordId__c" = "v"."RecordId__c"
ORDER BY "Score" DESC
    LIMIT :"NumOfResults"$$,
                main_user_query_parameter_name = 'SearchString',
                search_overall_score_column_name = 'Score',
                query_template_placeholders = [
                    (
                        placeholder_data_type = 'Text',
                        placeholder_name = ':"SearchString"',
                        placeholder_description = 'SearchString'
                    ),
                    (
                        placeholder_data_type = 'Number',
                        placeholder_name = ':"NumOfResults"',
                        placeholder_value = '10',
                        placeholder_description = 'NumOfResults'
                    ),
                    (
                        placeholder_data_type = 'Text',
                        placeholder_name = ':"Language"',
                        placeholder_value = 'en_US',
                        placeholder_description = 'Language'
                    )
                ]
            )
        )
    ),
    existing_retriever_asset => (name = 'knowledge_customsql_retriever_1Cx_tGW8aac9aec')
);
