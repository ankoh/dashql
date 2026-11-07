/**
 * Change the description and the refresh schedule of an existing segment, here to a refresh every 24 hours.
 *
 * The key is the `api_name`. The input schema is shared with create, so `description`, `display_name`, `segment_on_api_name` and `segment_type` are required again. The docs disagree on whether the SQL of a segment can change.
 */

call cdp.segment_get (segment_api_name => 'High_Value_Order_Buyers');

call cdp.segment_update (
    segment_api_name => 'High_Value_Order_Buyers',
    display_name => 'High Value Order Buyers',
    description => 'Refreshed every 24 hours',
    segment_on_api_name => 'Individuals__dlm',
    segment_type => 'Dbt',
    publish_schedule => 'TwentyFour'
);
