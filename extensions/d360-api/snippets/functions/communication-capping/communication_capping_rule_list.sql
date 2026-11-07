/**
 * Review the caps of a configuration with their limits and date windows, or find the id of a rule.
 *
 * The response has no total or next-page field, so a short page is the only sign of the end. `source` is `API` in the reference's sample.
 */

call cdp.communication_capping_rule_list (
    id => '1CCxx0000004C92AAE',
    limit => 50,
    offset => 0,
    order_by_column => 'StartDate',
    order_by_direction => 'DESC'
);
