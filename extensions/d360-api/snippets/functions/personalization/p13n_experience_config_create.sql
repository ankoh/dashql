/**
 * Put personalized content on a website: what to show (`data_provider`), where (`source_matchers`) and how to render it (`transformation_config`).
 *
 * The connector, the transformer and the point must exist already. `substitutions` set the variables the transformer defines. No source says whether a URL matcher and a content zone in one `source_matchers` list combine as AND or OR.
 */

call cdp.p13n_experience_config_create (
    id_or_app_source_id_or_name => 'my_website_connector',
    name => 'homepage_hero_banner',
    label => 'Homepage Hero Banner Personalization',
    is_enabled => true,
    data_provider => (
        type = 'PersonalizationPoint',
        reference_type = 'ApiName',
        value = 'hero_banner_recommendations',
        dataspace_reference_type = 'ApiName',
        dataspace_value = 'default',
        group_by_type = 'DataGraph',
        group_by_reference_type = 'ApiName',
        group_by_value = 'user_profile_graph'
    ),
    source_matchers => [(type = 'PageUrlMatcher', value = '/home'), (type = 'ContentZone', value = 'hero_section')],
    transformation_config => (
        render_if_empty = false,
        when = 'Immediately',
        method = 'ReplaceContentZoneContent',
        engagement_destination = 'banner_click_destination',
        transformations = [(
            transformer_name = 'promo_banner_transformer',
            substitutions = (bannerTitle = '{{data.title}}', bannerImage = '{{data.image}}', ctaText = 'Learn More')
        )]
    ),
    display_url => '/home'
);
