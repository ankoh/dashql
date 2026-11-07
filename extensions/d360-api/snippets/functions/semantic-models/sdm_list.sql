/**
 * List the semantic models of a data space, filtered by category and sorted, to find the `api_name` other calls take as the model.
 *
 * The result has one row per model. Page with `offset` and `limit`, or follow the next page URL the response carries.
 */

call cdp.sdm_list (
    dataspace => 'default',
    category => 'Sales',
    search_term => 'Revenue',
    order_by => 'apiName ASC',
    limit => 50
);
