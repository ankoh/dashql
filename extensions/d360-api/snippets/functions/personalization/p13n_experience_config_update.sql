/**
 * Turn an experience config off, or on again, without deleting it.
 *
 * The verb is `PUT`, but the sources describe it as a partial update where every field is optional. Check on an org that the other fields stay as they are, then read the config to see the result.
 */

call cdp.p13n_experience_config_update (
    id_or_app_source_id_or_name => 'my_website_connector',
    name_param => 'homepage_hero_banner',
    is_enabled => false
);

call cdp.p13n_experience_config_get (
    id_or_app_source_id_or_name => 'my_website_connector',
    name_param => 'homepage_hero_banner'
);
