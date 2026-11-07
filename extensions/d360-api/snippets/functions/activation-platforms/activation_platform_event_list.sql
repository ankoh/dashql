/**
 * List the standard events a streaming platform is configured for, such as Purchase or Add to Cart.
 *
 * Names can contain spaces. Take an event to `activation_platform_action_source_list` next. This reads streaming metadata, and no source says what a batch platform returns.
 */

call cdp.activation_platform_event_list (
    id_or_name => 'cdpactvstrgptnr__Meta_Conversions_API',
    page_size => 50,
    offset => 0
);
