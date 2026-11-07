/**
 * Remove a connection that nothing needs any more. Read it first to be sure the id is the one you mean.
 *
 * Data streams that depend on the connection break. Delete those first, the guide says so for web and mobile connectors, and other connectors can answer with `DEPENDENCY_EXISTS`.
 */

call cdp.connection_get (connection_id => '9cgaj0000012O5hAAE');

call cdp.connection_delete (connection_id => '9cgaj0000012O5hAAE');
