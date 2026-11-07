/**
 * List the joins between the data objects of a model, including those imported from existing Data 360 relationships, then read one.
 */

call cdp.sdm_relationships_list (model_api_name_or_id => 'AccountRevenue');

call cdp.sdm_relationship_get (
    model_api_name_or_id => 'AccountRevenue',
    relationship_name_or_id => 'Account_to_Opportunity'
);
