/**
 * Define a data graph that flattens an individual and its related records into one document per key.
 *
 * Creation also adds system DMOs and a transform. Read the graph until `status` is `ready`, compared without regard to case. The schedule runs a full refresh daily with the incremental refresh off. `type` is `NONE`, the only value the spec has.
 */

call cdp.data_graph_create (
    name => 'Customer_Graph',
    label => 'Customer Graph',
    description => 'One document per individual with the email addresses',
    dataspace_name => 'default',
    type => 'NONE',
    primary_object_name => 'ssot__Individual__dlm',
    full_refresh_config => (schedule = (frequency = 1, time_granularity = 'Day')),
    incremental_refresh_config => (enabled = false),
    source_object => (
        name = 'ssot__Individual__dlm',
        label = 'Individual',
        json_path = '$',
        type = 'standard',
        fields = [
            (
                source_field_name = 'ssot__Id__c',
                is_key_column = true,
                is_projected = true,
                data_type = 'Text',
                usage_tag = 'NONE'
            ),
            (
                source_field_name = 'KQ_Id__c',
                is_key_column = false,
                is_projected = true,
                data_type = 'Text',
                usage_tag = 'KEY_QUALIFIER'
            )
        ],
        related_objects = []
    )
);

call cdp.data_graph_get (data_graph_name => 'Customer_Graph');
