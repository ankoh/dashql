/**
 * Read one relationship with its join criteria. List the relationships first to find its name.
 */

call cdp.sdm_relationships_list (model_api_name_or_id => 'AccountRevenue');

call cdp.sdm_relationship_get (
    model_api_name_or_id => 'AccountRevenue',
    relationship_name_or_id => 'Account_to_Opportunity'
);
