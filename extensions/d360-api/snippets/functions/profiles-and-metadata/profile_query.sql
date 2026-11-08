/**
 * Read records of a Profile DMO that match equality filters, with the fields you pick, sorted and paged. It is the plain way to fetch people without writing SQL.
 *
 * Filters are equality tests joined by AND, and Engagement DMOs aren't supported. Each record is a row, with its fields in `_raw`.
 */

call cdp.profile_query (
    data_model_name => 'ssot__Individual__dlm',
    filters => '[ssot__FirstName__c=Jean,ssot__LastName__c=Dupont]',
    fields => 'ssot__Id__c,ssot__FirstName__c,ssot__LastName__c',
    order_by => 'ssot__LastName__c ASC',
    batch_size => 100,
    offset => 0
);
