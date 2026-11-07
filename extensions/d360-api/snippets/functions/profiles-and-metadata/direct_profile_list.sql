/**
 * Read the records of a Profile DMO on the tenant host with an equality filter, a sort and a page size. It is the tenant form of the profile query.
 *
 * The page size is `limit`, not `batch_size`, and `order_by` marks descending with a `-` prefix. Without `fields` you get up to 10 arbitrary fields.
 */

call cdp.direct_profile_list (
    data_model_name => 'Individual__dlm',
    fields => 'FirstName__c,LastName__c',
    filters => '[FirstName__c=John]',
    order_by => 'LastName__c,-FirstName__c',
    limit => 100,
    offset => 0
);
