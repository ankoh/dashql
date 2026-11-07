/**
 * Query a model by naming fields, filters and groupings, and the engine works out the joins and SQL. This groups accounts by region and revenue tier, keeps those with revenue, and sorts by the total.
 *
 * Group fields set `row_grouping`, and a field to total sets `semantic_aggregation_method`. Name the model by `semantic_model_api_name`, the way the guide prefers.
 */

call cdp.sdm_query (
    semantic_model_api_name => 'AccountRevenue',
    dataspace => 'default',
    structured_semantic_query => (
        fields = [
            (
                expression = (table_field = (name = 'Region', table_name = 'Account')),
                alias = 'Region',
                row_grouping = true
            ),
            (expression = (semantic_field = (name = 'Revenue_Tier')), alias = 'RevenueSegment', row_grouping = true),
            (
                expression = (table_field = (name = 'AnnualRevenue', table_name = 'Account')),
                alias = 'TotalRevenue',
                semantic_aggregation_method = 'SEMANTIC_AGGREGATION_METHOD_SUM'
            )
        ],
        filter = (
            binary_predicate = (
                left_expression = (table_field = (name = 'AnnualRevenue', table_name = 'Account')),
                binary_operator = 'BINARY_OPERATOR_GREATER_THAN',
                right_expression = (int_expression = 0)
            )
        ),
        options = (
            sort_orders = [(simple_sort_order = (sort_by_field_alias = 'TotalRevenue', sorting_order = 'DESC'))],
            limit_options = (limit = 100)
        )
    )
);
