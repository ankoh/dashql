/**
 * Delete a point after you checked which experience configs use it.
 *
 * Personalization at that point stops immediately, references from experiments or batch decisions break, and a delete can't be undone. The list finds the experience configs, once per connector.
 */

call cdp.p13n_point_get (id_or_name => 'home_page_experience');

call cdp.p13n_experience_config_list (
    id_or_app_source_id_or_name => 'my_website_connector',
    personalization_point_name_or_id => 'home_page_experience'
);

call cdp.p13n_point_delete (id_or_name => 'home_page_experience');
