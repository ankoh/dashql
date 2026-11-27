//! The extensions of SQL that a host offers its scripts.
//!
//! DashQL extends SQL with comment tags (`@vis`, `@board`, `@flow`, `@param`, `@manual`) and with named parameters
//! (`:min` as a value, `from :foo` as a table). A host that offers only some of them, e.g. a console of a database
//! service, lists the capabilities it offers. Parsing doesn't change: the analyzer reads what is not offered and flags
//! it with a `DISABLED_CAPABILITY` diagnostic. A disabled tag is a warning and is ignored, its statement runs like one
//! with an ordinary comment. A disabled parameter is an error of its statement, the planner doesn't run it.
//!
//! The capabilities belong to the catalog snapshot that a script is analyzed against (`CatalogSnapshot::capabilities`),
//! so every script of a connection sees the same and an analysis keeps those it was made with. A host names them as
//! a list (`Capabilities::only`), without one it offers all of them like DashQL.

/// The extensions of SQL that scripts may use, all of them by default
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Capabilities {
    /// `params`: named scalar parameters (`where x > :min`), the inputs of a workbook, and their `@param` tags
    pub params: bool,
    /// `table_parameters`: named table parameters (`from :foo`), the results of other scripts and the attached files
    pub table_parameters: bool,
    /// `vis`: the visualizations of `@vis` tags
    pub vis: bool,
    /// `board`: the dashboard placements of `@board` tags
    pub board: bool,
    /// `flow`: the dataflow positions of `@flow` tags
    pub flow: bool,
    /// `manual`: the scripts that run only on request, `@manual` tags
    pub manual: bool,
}

impl Capabilities {
    /// The names of the capabilities
    pub const NAMES: [&'static str; 6] = ["params", "table_parameters", "vis", "board", "flow", "manual"];

    /// Every extension, the capabilities of DashQL
    pub const ALL: Self =
        Self { params: true, table_parameters: true, vis: true, board: true, flow: true, manual: true };

    /// No extension, plain SQL
    pub const NONE: Self =
        Self { params: false, table_parameters: false, vis: false, board: false, flow: false, manual: false };

    /// Only the named capabilities. An unknown name is an error, so that a typo doesn't turn a capability off.
    pub fn only<'a>(names: impl IntoIterator<Item = &'a str>) -> Result<Self, String> {
        let mut capabilities = Self::NONE;
        for name in names {
            *capabilities.flag_mut(name).ok_or_else(|| {
                format!("unknown capability \"{name}\", expected one of {}", Self::NAMES.join(", "))
            })? = true;
        }
        Ok(capabilities)
    }

    fn flag_mut(&mut self, name: &str) -> Option<&mut bool> {
        Some(match name {
            "params" => &mut self.params,
            "table_parameters" => &mut self.table_parameters,
            "vis" => &mut self.vis,
            "board" => &mut self.board,
            "flow" => &mut self.flow,
            "manual" => &mut self.manual,
            _ => return None,
        })
    }

    /// Is a comment tag offered? A name that is no tag of a capability is.
    pub fn tag_enabled(&self, tag: &str) -> bool {
        match tag {
            "vis" => self.vis,
            "board" => self.board,
            "flow" => self.flow,
            "param" => self.params,
            "manual" => self.manual,
            _ => true,
        }
    }
}

impl Default for Capabilities {
    fn default() -> Self {
        Self::ALL
    }
}

#[cfg(test)]
mod tests {
    use super::Capabilities;

    #[test]
    fn tags_follow_their_capabilities() {
        let capabilities = Capabilities::only(["board", "flow", "manual", "table_parameters"]).unwrap();
        assert!(!capabilities.tag_enabled("vis"));
        assert!(!capabilities.tag_enabled("param"));
        assert!(capabilities.tag_enabled("board"));
        assert!(capabilities.tag_enabled("end"));
        assert_eq!(Capabilities::default(), Capabilities::ALL);
        assert_eq!(Capabilities::only(Capabilities::NAMES).unwrap(), Capabilities::ALL);
        assert_eq!(Capabilities::only([]).unwrap(), Capabilities::NONE);
        assert!(["vis", "board", "flow", "param", "manual"].iter().all(|t| !Capabilities::NONE.tag_enabled(t)));
    }

    #[test]
    fn unknown_names_fail() {
        assert!(Capabilities::only(["vis", "charts"]).unwrap_err().contains("unknown capability \"charts\""));
    }
}
