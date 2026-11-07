/**
 * Describe one object of the org: its fields, keys, indexes and relationships. Use it after finding the name with an inventory call.
 *
 * Always pass `entity_name`, since unfiltered responses are large. The result is one row with the entities in its `metadata` array, and only the DMOs in use appear here.
 */

call cdp.metadata (
    entity_name => 'ssot__Individual__dlm',
    entity_type => 'DataModelObject',
    entity_category => 'Profile',
    dataspace => 'default'
);
