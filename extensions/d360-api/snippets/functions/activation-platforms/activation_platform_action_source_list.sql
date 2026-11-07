/**
 * List the action sources an event of a platform allows, such as Website or Physical Store, to build the pair that scopes `activation_external_platform_get`.
 *
 * Names are display text with spaces, such as `Business Messaging - WhatsApp`. Follow `next_page_url` to get further pages.
 */

call cdp.activation_platform_action_source_list (
    id_or_name => 'cdpactvstrgptnr__Meta_Conversions_API',
    event_name => 'Purchase',
    page_size => 50,
    offset => 0
);
