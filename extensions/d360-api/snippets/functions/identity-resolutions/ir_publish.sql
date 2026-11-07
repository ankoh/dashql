/**
 * Publish a ruleset so identity resolution can use it.
 *
 * This call comes from Salesforce's MCP server and isn't in the spec. No source documents how to tell it finished; `ruleset_status` of the ruleset suggests `PUBLISHING`, then `PUBLISHED` or `ERROR`.
 */

call cdp.ir_publish (identity_resolution_id => '1irfj000000IWhWAAW');

call cdp.ir_get (identity_resolution => '1irfj000000IWhWAAW');
