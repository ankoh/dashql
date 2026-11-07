/**
 * Remove a data object from a model. The DMO itself is untouched, since the model only holds a reference to it.
 *
 * Removing an object breaks what joins through it. With `relationship_cascade_delete` the relationships that depend on it go too, so look at the model's relationships first.
 */

call cdp.sdm_relationships_list (model_api_name_or_id => 'AccountRevenue');

call cdp.sdm_data_object_delete (
    model_api_name_or_id => 'AccountRevenue',
    data_object_name_or_id => 'Opportunity',
    relationship_cascade_delete => true
);
