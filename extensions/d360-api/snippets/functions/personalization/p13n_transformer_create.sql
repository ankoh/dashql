/**
 * Create the template that renders personalized content on a website, with variables each experience config can customize.
 *
 * `SchemaPath` variables take data from the personalization point, `Static` ones are fixed values. Experience configs refer to the transformer by its `name`. The HTML is a verbatim string.
 */

call cdp.p13n_transformer_create (
    name => 'promo_banner_transformer',
    label => 'Promotional Banner Transformer',
    channel => 'WebApp',
    transformer_type => 'Handlebars',
    is_enabled => true,
    data_connectors => ['my_website_connector'],
    dataspace => 'default',
    substitution_definitions => (
        "bannerTitle" = (
            label = 'Banner Title',
            configType = 'SchemaPath',
            defaultValue = '{{recommendation.title}}',
            overridable = true,
            required = true
        ),
        "ctaText" = (
            label = 'Call to Action Text',
            configType = 'Static',
            defaultValue = 'Shop Now',
            overridable = true,
            required = true
        )
    ),
    transformer_type_details => (
        html = $$<div class="promo-banner"><h2>{{bannerTitle}}</h2><button class="cta-button">{{ctaText}}</button></div>$$,
        disable_auto_injection_of_engagement_attributes = false
    )
);
