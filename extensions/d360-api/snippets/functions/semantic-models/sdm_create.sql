/**
 * Create a semantic model, here in one call with two data objects, the join between them and a calculated measurement. An empty shell with only the three required options works too, and later calls fill it in.
 *
 * Formulas are Tableau-style and go in `$$ ... $$`. A measurement whose formula aggregates needs `aggregation_type => 'UserAgg'`. Authoring uses semantic `api_name` values, not `__dlm` or `__c` names.
 */

call cdp.sdm_create (
    api_name => 'AccountRevenue',
    label => 'Account Revenue Model',
    dataspace => 'default',
    description => 'Accounts and revenue',
    categories => 'Sales',
    agent_enabled => true,
    semantic_data_objects => [
        (
            data_object_name = 'ssot__Account__dlm',
            data_object_type = 'Dmo',
            api_name = 'Account',
            label = 'Account',
            should_include_all_fields = true
        ),
        (
            data_object_name = 'ssot__Opportunity__dlm',
            data_object_type = 'Dmo',
            api_name = 'Opportunity',
            label = 'Opportunity',
            should_include_all_fields = true
        )
    ],
    semantic_relationships => [(
        label = 'Account to Opportunity',
        api_name = 'Account_to_Opportunity',
        left_semantic_definition_api_name = 'Account',
        right_semantic_definition_api_name = 'Opportunity',
        cardinality = 'OneToMany',
        criteria = [(
            join_operator = 'Equals',
            left_semantic_field_api_name = 'Account_Id',
            right_semantic_field_api_name = 'AccountId'
        )]
    )],
    semantic_calculated_measurements => [(
        label = 'Total Pipeline',
        api_name = 'Total_Pipeline',
        data_type = 'Number',
        aggregation_type = 'UserAgg',
        expression = $$SUM([Opportunity].[Amount])$$
    )]
);
