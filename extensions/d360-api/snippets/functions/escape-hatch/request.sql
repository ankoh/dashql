/**
 * Send a request that no function covers, here the next batch of `metadata_entities`, which that function can't page to.
 *
 * `path` is relative to `host`, which is one of the names of the spec. The result is one row with the response in `_raw`. A raw call with a method other than `GET` counts as a write.
 */

call cdp.metadata_entities (entity_type => 'DataModelObject', entity_category => 'Profile');

call cdp.request (
    method => 'GET',
    host => 'connect',
    path => '/ssot/metadata-entities/b2c8e1f4-0a7d-4c55-9c1e-3d5f7a902b64'
);
