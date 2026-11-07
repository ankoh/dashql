/**
 * Delete a relationship from a model. Queries that join through it stop working, so read it first.
 */

call cdp.sdm_relationship_get (
    model_api_name_or_id => 'AccountRevenue',
    relationship_name_or_id => 'Account_to_Opportunity'
);

call cdp.sdm_relationship_delete (
    model_api_name_or_id => 'AccountRevenue',
    relationship_name_or_id => 'Account_to_Opportunity'
);
