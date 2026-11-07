/**
 * Step 5 of the semantic model.
 *
 * Query the measure.
 */

call cdp.sdm_query (
    semantic_model_api_name => 'AccountRevenue',
    structured_semantic_query => (
        fields = [(
            expression = (semantic_field = (name = 'Total_Revenue')),
            alias = 'revenue',
            semantic_aggregation_method = 'SEMANTIC_AGGREGATION_METHOD_USER_AGG'
        )]
    )
);
