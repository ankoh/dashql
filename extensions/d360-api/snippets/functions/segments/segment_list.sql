/**
 * Find the segments of a data space with their API names and status.
 *
 * Filters are joined with AND, and the filter and sort names such as `SegmentStatus` and `MarketSegmentType` are not column names. Page with `batch_size` (1 to 200) and `offset`.
 */

call cdp.segment_list (
    dataspace => 'default',
    batch_size => 100,
    offset => 0,
    filters => 'SegmentStatus eq Active AND MarketSegmentType eq Dbt',
    order_by => 'Name ASC'
);
