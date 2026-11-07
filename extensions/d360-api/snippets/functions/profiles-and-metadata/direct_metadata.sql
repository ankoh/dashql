/**
 * Describe the objects of the org on the tenant host, with their fields, keys and relationships. It is the tenant form of the general metadata call, so prefer that one unless you need this host.
 *
 * It always needs the token exchange. Pass `entity_name`, since the unfiltered answer is large.
 */

call cdp.direct_metadata (
    entity_name => 'ssot__Individual__dlm',
    entity_type => 'DataModelObject',
    entity_category => 'Profile'
);
