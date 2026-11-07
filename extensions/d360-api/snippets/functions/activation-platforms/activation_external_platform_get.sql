/**
 * Read one external platform with its attribute configuration, scoped to an event and an action source, such as a Purchase on a Website.
 *
 * `destination_name` of the attributes is what `external_platform_attribute_name` of an activation refers to. Find the valid event and action source pairs with `activation_platform_event_list` and `activation_platform_action_source_list`.
 */

call cdp.activation_external_platform_get (
    id_or_name => '1sqxx0000000087AAA',
    event_name => 'Purchase',
    action_source => 'Website'
);
