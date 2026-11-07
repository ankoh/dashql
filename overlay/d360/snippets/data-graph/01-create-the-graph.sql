/**
 * Step 1 of the data graph.
 *
 * Create a graph on the individual object.
 */

CALL cdp.data_graph_create (name => 'Customer_Graph', label => 'Customer Graph', type => 'NONE', primary_object_name => 'ssot__Individual__dlm', source_object => (name = 'ssot__Individual__dlm', type = 'standard', json_path = '$', fields = [(source_field_name = 'ssot__Id__c', is_key_column = true, is_projected = true, data_type = 'Text', usage_tag = 'NONE')], related_objects = []));
