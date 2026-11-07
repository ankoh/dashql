/**
 * List the data transforms of the org, sorted and in pages of up to 20.
 *
 * `limit` stops at 20, so move through the list with `offset`. `errors` in the result names transforms that couldn't be read even though the call succeeded. `filter_group => 'Small'` keeps the essential properties but doesn't drop `definition`.
 */

call cdp.transform_list (filter_group => 'Medium', order_by => 'LastRunTimeDesc', limit => 20, offset => 20);
