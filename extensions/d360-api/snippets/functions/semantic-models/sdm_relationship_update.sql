/**
 * Change a relationship's cardinality, join type or join criteria, here to an inner join on a different pair of fields.
 */

call cdp.sdm_relationship_update (
    model_api_name_or_id => 'AccountRevenue',
    relationship_name_or_id => 'Account_to_Opportunity',
    label => 'Account to Opportunity (inner)',
    cardinality => 'ManyToOne',
    join_type => 'Inner',
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
