/**
 * Find the active Amazon S3 targets, newest first.
 *
 * `filters` uses `in` and is joined with `AND`. There is no data space option, so filter on `dataspace_name` yourself. The response has no total, so page with `offset` and `batch_size`.
 */

call cdp.activation_target_list (
    filters => 'targetStatus in active AND platformName in Amazon S3',
    order_by => 'createdDate desc',
    batch_size => 50,
    offset => 0
);
