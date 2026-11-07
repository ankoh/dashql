/**
 * Read the members of a published segment, with the change type and the time of each.
 *
 * The segment must be published, because an unpublished one returns an empty result. Members come back in the `data` column as JSON. Names in `fields`, `filters` and `order_by` end in `__c`, while the keys in `data` don't. Filtering on `Delta_Type__c` goes with a filter on `Timestamp__c`.
 */

call cdp.segment_member_list (
    segment_api_name => 'High_Value_Order_Buyers',
    fields => ['Id__c', 'KQ_Id__c', 'Delta_Type__c', 'Timestamp__c'],
    filters => $$Delta_Type__c IN ('New','Existing') AND Timestamp__c IN 2026-04-09T14:12:41.111Z$$,
    order_by => 'Timestamp__c DESC',
    limit => 100,
    offset => 0
);
