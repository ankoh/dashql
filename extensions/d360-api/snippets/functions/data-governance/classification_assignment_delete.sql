/**
 * Take away one link between a classification and a tag.
 *
 * The link is read by its id first. Only the link goes, the classification and the tag stay.
 */

call cdp.classification_assignment_get (id => '9aa000000000050');

call cdp.classification_assignment_delete (id => '9aa000000000050');
