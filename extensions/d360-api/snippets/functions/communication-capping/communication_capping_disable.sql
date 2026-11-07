/**
 * Turn a capping configuration off. Read it first to see its status.
 *
 * The response has its own `success` and `errors`, so check `success` and not only the HTTP status. The sources don't say what happens to segments activated through its targets while it is off.
 */

call cdp.communication_capping_configuration_get (id => '1CCxx0000004C92AAE');

call cdp.communication_capping_disable (id => '1CCxx0000004C92AAE');
