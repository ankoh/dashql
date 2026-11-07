/**
 * Show what a permission set may access, the grants it holds across objects.
 *
 * A single filter gives a whole view: the permission set alone lists its grants, the object alone lists the permission sets that grant it. What combinations do isn't documented.
 */

call cdp.object_access_grant_list (permission_set_name => 'DC_Analyst_PermSet', limit => 50);
