/**
 * Profile the values of a data source: minimum, maximum and buckets for numeric fields, distinct values with row counts for text fields. Use it to spot constant numbers, class imbalance and dominant categories before you train.
 */

call cdp.ml_query_data_profile (
    input => (type = 'DataModelObject', source = (name = 'Attrition__dlm'), dataspace = (name = 'default')),
    profile_field_names => [
        (name = 'Attrition__c', source = 'Attrition__dlm', type = 'DataModelObject'),
        (name = 'Monthly_Income__c', source = 'Attrition__dlm', type = 'DataModelObject'),
        (name = 'Over_Time__c', source = 'Attrition__dlm', type = 'DataModelObject')
    ]
);
