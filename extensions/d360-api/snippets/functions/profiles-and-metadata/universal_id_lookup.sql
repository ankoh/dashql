/**
 * Starting from one source record, find the records of every source that are linked to the same unified individual. Use it to collect a person's ids across systems.
 *
 * Each item of `data` has `SourceRecordId__c`, `UnifiedRecordId__c`, `ssot__DataSourceObjectId__c` and `ssot__DataSourceId__c`.
 */

call cdp.universal_id_lookup (
    entity_name => 'IndividualIdentityLink__dlm',
    data_source_id => 'SFMC1487860',
    data_source_object_id => 'SFMC1487860_EmailProfile',
    source_record_id => '100060522'
);

call cdp.profile_get (
    data_model_name => 'ssot__Individual__dlm',
    id => '100060522',
    fields => 'ssot__Id__c,ssot__FirstName__c'
);
