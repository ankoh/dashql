/**
 * Starting from one source record, find the records of every source linked to the same unified individual, on the tenant host. It is the tenant form of the universal id lookup.
 *
 * The four options are path segments, and they carry their field names as option names.
 */

call cdp.direct_universal_id_lookup (
    entity_name => 'IndividualIdentityLink__dlm',
    DataSourceId__c => 'SFMC1487860',
    DataSourceObjectId__c => 'SFMC1487860_EmailProfile',
    SourceRecordId__c => '100060522'
);
