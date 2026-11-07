/**
 * List the activation platforms of the org with their status, to see which are ready and which are in error.
 *
 * `enabled` and `status` are separate: a platform can be enabled and still have the status `Error`. Summaries have no `privacy_type` or description, so read one with `activation_platform_get`.
 */

call cdp.activation_platform_list (
    activation_platform_view => 'Developer',
    order_by => 'name ASC',
    batch_size => 50,
    offset => 0
);
