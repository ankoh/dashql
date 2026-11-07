/**
 * List the fields of a data source and the transformations that apply to them. This is the first call when you author a model setup.
 *
 * With `filter_fields => true` the result also lists the fields that are eligible for filters. Pass the fields to `ml_setup_version_create` as they come back.
 */

call cdp.ml_query_setup_fields (
    input => (type = 'DataModelObject', source = (name = 'Attrition__dlm'), dataspace = (name = 'default')),
    filter_fields => true
);
