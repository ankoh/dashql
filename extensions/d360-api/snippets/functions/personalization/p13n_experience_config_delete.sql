/**
 * Remove an experience config for good, which stops its delivery to the website or app.
 *
 * Read it first to be sure it is the one you mean. A delete can't be undone.
 */

call cdp.p13n_experience_config_get (
    id_or_app_source_id_or_name => 'my_website_connector',
    name_param => 'homepage_hero_banner'
);

call cdp.p13n_experience_config_delete (
    id_or_app_source_id_or_name => 'my_website_connector',
    name_param => 'homepage_hero_banner'
);
