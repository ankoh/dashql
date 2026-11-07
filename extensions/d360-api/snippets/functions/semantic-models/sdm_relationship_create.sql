/**
 * Define the join between two data objects of a model. A query across objects needs a path of these, so add it once both objects are in the model.
 *
 * `cardinality` says how many right rows match one left row. Each criterion compares one field of each side.
 */

call cdp.sdm_relationship_create (
    model_api_name_or_id => 'AccountRevenue',
    label => 'Account to Opportunity',
    api_name => 'Account_to_Opportunity',
    left_semantic_definition_api_name => 'Account',
    right_semantic_definition_api_name => 'Opportunity',
    cardinality => 'OneToMany',
    join_type => 'Auto',
    is_enabled => true,
    criteria => [(
        join_operator = 'Equals',
        left_field_type = 'TableField',
        left_semantic_field_api_name = 'Account_Id',
        right_field_type = 'TableField',
        right_semantic_field_api_name = 'AccountId'
    )]
);

call cdp.sdm_relationship_get (
    model_api_name_or_id => 'AccountRevenue',
    relationship_name_or_id => 'Account_to_Opportunity'
);
