/**
 * List the columns of a data source that could be the training target. `prediction_type` narrows the list to the columns that suit one type of prediction.
 */

call cdp.ml_query_outcome (
    input => (type = 'DataModelObject', source = (name = 'Attrition__dlm'), dataspace = (name = 'default')),
    prediction_type => 'BinaryClassification'
);

call cdp.ml_query_row_count (
    input => (type = 'DataModelObject', source = (name = 'Attrition__dlm'), dataspace = (name = 'default'))
);
