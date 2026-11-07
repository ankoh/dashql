/**
 * Disable an insight, which can affect the segments and activations that depend on it.
 *
 * Read it first. The call is not in the spec, and nothing says what happens to a segment that filters on a disabled insight.
 */

call cdp.ci_get (api_name => 'Customer_Order_Summary__cio');

call cdp.ci_disable (ci_name => 'Customer_Order_Summary__cio');
