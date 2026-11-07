/**
 * Find access policies by a word in their name or label, including the ones the policy builder can't edit.
 *
 * `include_incompatible` adds system and legacy policies. `limit` takes 5 to 200. An org without the feature can answer 404.
 */

call cdp.access_policy_list (search_string => 'mask', include_incompatible => true, limit => 25, _pages => 2);
