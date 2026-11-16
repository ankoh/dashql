/**
 * Disable an insight, which can affect the segments and activations that depend on it.
 *
 * Read it first. The call is not in the spec, and nothing says what happens to a segment that filters on a disabled insight.
 */

call d360.ci_get (api_name => 'Customer_Order_Summary__cio');

call d360.ci_disable (ci_name => 'Customer_Order_Summary__cio');
