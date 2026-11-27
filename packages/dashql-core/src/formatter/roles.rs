//! GRANT and REVOKE of privileges and roles, and CREATE, ALTER and DROP of roles.
//!
//! The parser keeps no difference between ROLE, USER and GROUP in ALTER and DROP, and none between the optional
//! `TABLE` and `PRIVILEGES` and their absence. The formatter writes `role` (`group` for adding and dropping members),
//! `on table` and `all`.

use super::{is_true, value_u8, FmtReg, Formatter, K};
use dashql_buffers::parser::{AlterRoleAction, GrantTargetType, Node, Privilege, RoleOption, RoleType};
use dashql_parser::attrs;

impl<'a> Formatter<'a> {
    /// `select (a, b)`, `usage` or `all`, a privilege of GRANT and REVOKE, or a role of GRANT and REVOKE of roles
    pub(super) fn format_grant_access_privilege(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [kind, name, columns] = attrs!(
            self.children(node),
            [
                K::SQL_GRANT_ACCESS_PRIVILEGE_KIND,
                K::SQL_GRANT_ACCESS_PRIVILEGE_NAME,
                K::SQL_GRANT_ACCESS_PRIVILEGE_COLUMNS,
            ]
        );
        let Some(head) = kind.or(name) else { return self.format_unimplemented(node) };
        let mut parts = vec![self.reg_or_placeholder(head)];
        if let Some(columns) = columns {
            parts.push(f.text(" "));
            parts.push(f.parenthesized(self.reg_or_placeholder(columns)));
        }
        f.concat(&parts)
    }

    pub(super) fn format_privilege(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        match Privilege(value_u8(node)) {
            Privilege::ALL => f.text("all"),
            Privilege::CREATE => f.text("create"),
            Privilege::REFERENCES => f.text("references"),
            Privilege::SELECT => f.text("select"),
            _ => self.format_unimplemented(node),
        }
    }

    /// `on table t`, `on all functions in schema s`, the objects of GRANT and REVOKE
    pub(super) fn format_grant_target(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [kind, all_in_schema, objects] = attrs!(
            self.children(node),
            [K::SQL_GRANT_TARGET_KIND, K::SQL_GRANT_TARGET_ALL_IN_SCHEMA, K::SQL_GRANT_TARGET_OBJECTS]
        );
        let (Some(kind), Some(objects)) = (kind, objects) else { return self.format_unimplemented(node) };
        use GrantTargetType as T;
        let keyword = match (GrantTargetType(value_u8(kind)), all_in_schema.is_some()) {
            (T::RELATION, false) => "table ",
            (T::RELATION, true) => "all tables in schema ",
            (T::SEQUENCE, false) => "sequence ",
            (T::SEQUENCE, true) => "all sequences in schema ",
            (T::FUNCTION, false) => "function ",
            (T::FUNCTION, true) => "all functions in schema ",
            (T::FOREIGN_DATA_WRAPPER, false) => "foreign data wrapper ",
            (T::FOREIGN_SERVER, false) => "foreign server ",
            (T::DATABASE, false) => "database ",
            (T::DOMAIN, false) => "domain ",
            (T::LANGUAGE, false) => "language ",
            (T::LARGE_OBJECT, false) => "large object ",
            (T::SCHEMA, false) => "schema ",
            (T::TABLESPACE, false) => "tablespace ",
            (T::TYPE, false) => "type ",
            _ => return self.format_unimplemented(node),
        };
        f.concat(&[f.text(keyword), self.reg_or_placeholder(objects)])
    }

    /// `f(integer, text)`, a function with the types of its arguments
    pub(super) fn format_function_with_arguments(&self, node: &'a Node) -> FmtReg {
        let [name, arguments] = attrs!(
            self.children(node),
            [K::SQL_FUNCTION_WITH_ARGUMENTS_NAME, K::SQL_FUNCTION_WITH_ARGUMENTS_ARGUMENTS]
        );
        let Some(name) = name else { return self.format_unimplemented(node) };
        self.name_with_args(name, arguments)
    }

    pub(super) fn format_grant(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [privileges, target, grantees, grant_option] = attrs!(
            self.children(node),
            [K::SQL_GRANT_PRIVILEGES, K::SQL_GRANT_TARGET, K::SQL_GRANT_GRANTEES, K::SQL_GRANT_BEHAVIOR]
        );
        let (Some(privileges), Some(target), Some(grantees)) = (privileges, target, grantees) else {
            return self.format_unimplemented(node);
        };
        let mut clauses = vec![
            f.concat(&[f.text("grant "), self.reg_or_placeholder(privileges)]),
            f.concat(&[f.text("on "), self.reg_or_placeholder(target)]),
            f.concat(&[f.text("to "), self.reg_or_placeholder(grantees)]),
        ];
        if grant_option.is_some() {
            clauses.push(f.text("with grant option"));
        }
        self.format_command_clauses(&clauses)
    }

    pub(super) fn format_revoke(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [grant_option, privileges, target, grantees, behavior] = attrs!(
            self.children(node),
            [
                K::SQL_REVOKE_GRANT_OPTION,
                K::SQL_REVOKE_PRIVILEGES,
                K::SQL_REVOKE_TARGET,
                K::SQL_REVOKE_GRANTEES,
                K::SQL_REVOKE_BEHAVIOR,
            ]
        );
        let (Some(privileges), Some(target), Some(grantees)) = (privileges, target, grantees) else {
            return self.format_unimplemented(node);
        };
        let keyword = if grant_option.is_some() { "revoke grant option for " } else { "revoke " };
        let mut clauses = vec![
            f.concat(&[f.text(keyword), self.reg_or_placeholder(privileges)]),
            f.concat(&[f.text("on "), self.reg_or_placeholder(target)]),
            f.concat(&[f.text("from "), self.reg_or_placeholder(grantees)]),
        ];
        if let Some(behavior) = behavior {
            clauses.push(self.reg_or_placeholder(behavior));
        }
        self.format_command_clauses(&clauses)
    }

    pub(super) fn format_grant_role(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [roles, grantees, admin_option, grantor] = attrs!(
            self.children(node),
            [
                K::SQL_GRANT_ROLE_ROLES,
                K::SQL_GRANT_ROLE_GRANTEES,
                K::SQL_GRANT_ROLE_BEHAVIOR,
                K::SQL_GRANT_ROLE_GRANTOR
            ]
        );
        let (Some(roles), Some(grantees)) = (roles, grantees) else { return self.format_unimplemented(node) };
        let mut clauses = vec![
            f.concat(&[f.text("grant "), self.reg_or_placeholder(roles)]),
            f.concat(&[f.text("to "), self.reg_or_placeholder(grantees)]),
        ];
        if admin_option.is_some() {
            clauses.push(f.text("with admin option"));
        }
        if let Some(grantor) = grantor {
            clauses.push(f.concat(&[f.text("granted by "), self.reg_or_placeholder(grantor)]));
        }
        self.format_command_clauses(&clauses)
    }

    pub(super) fn format_revoke_role(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [admin_option, roles, grantees, grantor, behavior] = attrs!(
            self.children(node),
            [
                K::SQL_REVOKE_ROLE_ADMIN_OPTION,
                K::SQL_REVOKE_ROLE_ROLES,
                K::SQL_REVOKE_ROLE_GRANTEES,
                K::SQL_REVOKE_ROLE_GRANTOR,
                K::SQL_REVOKE_ROLE_BEHAVIOR,
            ]
        );
        let (Some(roles), Some(grantees)) = (roles, grantees) else { return self.format_unimplemented(node) };
        let keyword = if admin_option.is_some() { "revoke admin option for " } else { "revoke " };
        let mut clauses = vec![
            f.concat(&[f.text(keyword), self.reg_or_placeholder(roles)]),
            f.concat(&[f.text("from "), self.reg_or_placeholder(grantees)]),
        ];
        if let Some(grantor) = grantor {
            clauses.push(f.concat(&[f.text("granted by "), self.reg_or_placeholder(grantor)]));
        }
        if let Some(behavior) = behavior {
            clauses.push(self.reg_or_placeholder(behavior));
        }
        self.format_command_clauses(&clauses)
    }

    pub(super) fn format_role_type(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        match RoleType(value_u8(node)) {
            RoleType::ROLE => f.text("role"),
            RoleType::USER => f.text("user"),
            RoleType::GROUP => f.text("group"),
            _ => self.format_unimplemented(node),
        }
    }

    /// `login`, `password 'pw'`, `in role a`, an option of CREATE and ALTER ROLE
    pub(super) fn format_role_element(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [kind, encrypted, arg] = attrs!(
            self.children(node),
            [K::SQL_ROLE_ELEMENT_KIND, K::SQL_ROLE_ELEMENT_ENCRYPTED, K::SQL_ROLE_ELEMENT_ARG]
        );
        let Some(kind) = kind else {
            // A keyword like `login` or `nosuperuser`
            let Some(arg) = arg else { return self.format_unimplemented(node) };
            return self.reg_or_placeholder(arg);
        };
        let keyword = match RoleOption(value_u8(kind)) {
            RoleOption::PASSWORD => match encrypted {
                Some(encrypted) if is_true(Some(encrypted)) => "encrypted password ",
                Some(_) => "unencrypted password ",
                None => "password ",
            },
            RoleOption::INHERIT if arg.is_none() => return f.text("inherit"),
            RoleOption::CONNECTION_LIMIT => "connection limit ",
            RoleOption::VALID_UNTIL => "valid until ",
            RoleOption::ADMIN => "admin ",
            RoleOption::ROLE => "role ",
            RoleOption::IN_ROLE => "in role ",
            _ => return self.format_unimplemented(node),
        };
        let arg = match arg {
            Some(arg) => self.reg_or_placeholder(arg),
            // `password null`
            None if RoleOption(value_u8(kind)) == RoleOption::PASSWORD => f.text("null"),
            None => return self.format_unimplemented(node),
        };
        f.concat(&[f.text(keyword), arg])
    }

    pub(super) fn format_create_role(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [role_type, role, options] =
            attrs!(self.children(node), [K::SQL_CREATE_ROLE_TYPE, K::SQL_CREATE_ROLE_ROLE, K::SQL_CREATE_ROLE_OPTIONS]);
        let (Some(role_type), Some(role)) = (role_type, role) else { return self.format_unimplemented(node) };
        let mut clauses = vec![f.concat(&[
            f.text("create "),
            self.reg_or_placeholder(role_type),
            f.text(" "),
            self.reg_or_placeholder(role),
        ])];
        if let Some(options) = options {
            clauses.push(f.concat(&[f.text("with "), self.reg_or_placeholder(options)]));
        }
        self.format_command_clauses(&clauses)
    }

    pub(super) fn format_alter_role(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [action, role, database, args] = attrs!(
            self.children(node),
            [K::SQL_ALTER_ROLE_ACTION, K::SQL_ALTER_ROLE_ROLE, K::SQL_ALTER_ROLE_DATABASE, K::SQL_ALTER_ROLE_ARGS]
        );
        let role = role.map(|r| self.reg_or_placeholder(r));
        let action = action.map(|a| AlterRoleAction(value_u8(a)));
        let mut clauses = Vec::with_capacity(3);
        match (action, role) {
            // Members of a group
            (Some(action @ (AlterRoleAction::ADD | AlterRoleAction::DROP)), Some(role)) => {
                let Some(args) = args else { return self.format_unimplemented(node) };
                let keyword = if action == AlterRoleAction::ADD { "add user " } else { "drop user " };
                clauses.push(f.concat(&[f.text("alter group "), role]));
                clauses.push(f.concat(&[f.text(keyword), self.reg_or_placeholder(args)]));
            }
            // `alter role r [in database db] set ...`, `alter role all reset ...`
            (Some(AlterRoleAction::SET), role) => {
                let Some(args) = args else { return self.format_unimplemented(node) };
                clauses.push(f.concat(&[f.text("alter role "), role.unwrap_or_else(|| f.text("all"))]));
                if let Some(database) = database {
                    clauses.push(f.concat(&[f.text("in database "), self.reg_or_placeholder(database)]));
                }
                clauses.push(self.reg_or_placeholder(args));
            }
            (None, Some(role)) => {
                clauses.push(f.concat(&[f.text("alter role "), role]));
                if let Some(args) = args {
                    clauses.push(f.concat(&[f.text("with "), self.reg_or_placeholder(args)]));
                }
            }
            _ => return self.format_unimplemented(node),
        }
        self.format_command_clauses(&clauses)
    }

    pub(super) fn format_drop_role(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [if_exists, roles] = attrs!(self.children(node), [K::SQL_DROP_ROLE_IF_EXISTS, K::SQL_DROP_ROLE_ROLES]);
        let Some(roles) = roles else { return self.format_unimplemented(node) };
        let if_exists = if if_exists.is_some() { f.text("if exists ") } else { f.empty() };
        f.concat(&[f.text("drop role "), if_exists, self.reg_or_placeholder(roles)])
    }
}
