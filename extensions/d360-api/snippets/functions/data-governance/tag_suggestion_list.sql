/**
 * List what the auto tagging job suggested for an object, filtered by the state of the suggestion.
 *
 * `status` is `New`, `Approved`, `Rejected` or `AutoRejected`. The new ones are those waiting for a decision.
 */

call cdp.tag_suggestion_list (object_name => 'Individual_DLO__dll', status => 'New', limit => 50);
