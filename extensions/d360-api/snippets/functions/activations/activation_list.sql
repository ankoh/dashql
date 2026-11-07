/**
 * Find the incremental activations that are active right now, newest first.
 *
 * Filters are written as `name in value` and joined with `AND`. The list leaves out attributes, contact points and filters, so read one activation with `activation_get` to see those.
 */

call cdp.activation_list (
    filters => 'activationStatus in active AND activationRefreshType in incremental',
    order_by => 'createdDate desc',
    batch_size => 50
);
