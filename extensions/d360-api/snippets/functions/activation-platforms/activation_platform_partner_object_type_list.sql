/**
 * List the kinds of partner objects a platform has, such as Pixel, App or ConversionRule.
 *
 * `type` is the value for `partner_object_type` of `activation_target_partner_object_list`, which then lists the objects of one kind.
 */

call cdp.activation_platform_partner_object_type_list (
    id_or_name => 'cdpactvstrgptnr__LinkedInPlatform',
    page_size => 50,
    offset => 0
);
