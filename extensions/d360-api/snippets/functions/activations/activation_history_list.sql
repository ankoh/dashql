/**
 * Look at the publish runs of an activation, newest first, to see when it last ran and how it ended.
 *
 * The id can also be a segment id (`1sg...`), which returns the runs of every activation on that segment. Each record has a `publishStatus` such as `Completed`, `Error` or `Skipped`. Follow `next_page_url` for the next page instead of building it.
 */

call cdp.activation_history_list (
    activation_id => '1sgVF000000LfbFYAS',
    limit => 50,
    offset => 0,
    order_by => 'publishEndTime desc'
);
