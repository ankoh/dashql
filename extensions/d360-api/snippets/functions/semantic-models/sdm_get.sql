/**
 * Read a whole model with its data objects, relationships, calculated fields and metrics inline. Reach for it to see the generated API names and the model `id`.
 *
 * `include_table_keys` adds the key qualifiers and primary key indicators of each data object.
 */

call d360.sdm_list (dataspace => 'default', label => 'Account Revenue Model');

call d360.sdm_get (
    model_api_name_or_id => 'AccountRevenue',
    include_table_keys => true,
    include_model_content => true,
    allow_unmapped => false
);
