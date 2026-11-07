/**
 * Read one experience config of a connector with its data provider, source matchers and transformation configuration.
 *
 * The config is addressed by its name only, not by an id. Pass `is_wpm_url_required` to ask for the Web Personalization Manager URL as well.
 */

call cdp.p13n_experience_config_list (id_or_app_source_id_or_name => 'my_website_connector');

call cdp.p13n_experience_config_get (
    id_or_app_source_id_or_name => 'my_website_connector',
    name_param => 'homepage_hero_banner',
    is_wpm_url_required => true
);
