/**
 * Step 3 of personalization. It needs the transformer, the personalization point and the website connector.
 *
 * Show the point in a content zone of the website.
 */

CALL cdp.p13n_experience_config_create (
  id_or_app_source_id_or_name => 'my_website_connector',
  name => 'homepage_hero_banner',
  label => 'Homepage Hero Banner',
  data_provider => (type = 'PersonalizationPoint', reference_type = 'ApiName', value = 'home_page_experience'),
  source_matchers => [(type = 'ContentZone', value = 'hero_section')],
  transformation_config => (when = 'Immediately', method = 'ReplaceContentZoneContent', transformations = [(transformer_name = 'promo_banner_transformer')])
);
