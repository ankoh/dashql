/**
 * Check whether a Data 360 profile asked to have its data exported. Use it to see the state of a privacy request after it was recorded.
 *
 * The flag in `proceed` is the string "true" or "false". A 200 response can still contain errors, so read the `result` column of every row.
 */

call cdp.consent_get (action => 'portability', ids => '100000695,100000696', mode => 'cdp');
