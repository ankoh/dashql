/**
 * Fetch profile records by a key, here by first name instead of the primary key, which `search_key` switches on. Find candidates with a query first.
 *
 * `offset` needs `order_by` on this route.
 */

call cdp.profile_query (
    data_model_name => 'ssot__Individual__dlm',
    filters => '[ssot__LastName__c=Dupont]',
    fields => 'ssot__Id__c,ssot__FirstName__c'
);

call cdp.profile_get (
    data_model_name => 'ssot__Individual__dlm',
    id => 'Jean',
    search_key => 'ssot__FirstName__c',
    fields => 'ssot__Id__c,ssot__LastName__c',
    order_by => 'ssot__LastName__c ASC',
    batch_size => 50,
    offset => 0
);
