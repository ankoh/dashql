/**
 * Read a point with its decisions, schema, authentication setting and sync status.
 *
 * `status` is `Active` when the point is ready; the Point DMO also lists `Processing`, `Error` and `Deleting`. There is no list call for points. The first call finds the experience configs that use this point.
 */

call cdp.p13n_experience_config_list (
    id_or_app_source_id_or_name => 'my_website_connector',
    personalization_point_name_or_id => 'home_page_experience'
);

call cdp.p13n_point_get (id_or_name => 'home_page_experience');
