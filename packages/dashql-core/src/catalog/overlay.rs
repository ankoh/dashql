//! Overlays: a declarative description of an API that shadows a namespace of `CALL` on a connection.
//!
//! A host registers an overlay on the catalog of a connection (see `docs/design/overlay.md`). The core reads the
//! generic part of the spec: namespaces, functions, typed named options, nested schemas and result columns. Everything
//! a request needs (methods, paths, wire names) stays in the document for the runtime of the host, the core ignores it.

use crate::error::{Error, Result};
use crate::hash::HashMap;
use serde::{Deserialize, Deserializer};
use std::sync::Arc;

/// The version of the format that the core reads
pub const OVERLAY_FORMAT: u32 = 1;

/// The standard option that takes the next page of a paged function
pub const OPTION_NEXT: &str = "_next";
/// The standard option that limits the pages of a call
pub const OPTION_PAGES: &str = "_pages";
/// The standard option that polls a pending result
pub const OPTION_POLL: &str = "_poll";
/// The standard option that waits for a pending result
pub const OPTION_WAIT: &str = "_wait";

/// What an option or attribute that the spec does not list does
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OverlayUnknownPolicy {
    /// An error
    #[default]
    Error,
    /// A warning, it is sent as written. For schemas that may be incomplete.
    Warning,
    /// Accepted silently, for free-form maps
    Allow,
}

/// Does a function change anything?
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OverlayEffect {
    Read,
    Write,
}

/// An option of a function or an attribute of a schema
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct OverlayAttribute {
    /// The name in a script
    pub name: String,
    /// The type of a scalar value
    #[serde(rename = "type")]
    pub value_type: Option<String>,
    /// The schema of an object value
    pub schema: Option<String>,
    /// Is the attribute required?
    pub required: bool,
    /// The description that completion shows
    pub description: Option<String>,
}

/// A named object
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct OverlaySchema {
    /// The attributes
    pub attributes: Vec<OverlayAttribute>,
    /// What an attribute that is not listed does
    pub unknown: OverlayUnknownPolicy,
}

/// A result column
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct OverlayColumn {
    /// The name in a script
    pub name: String,
    /// The column type
    #[serde(rename = "type")]
    pub column_type: Option<String>,
}

/// A value that must be a `secret()`
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct OverlaySensitive {
    /// A JSON pointer over the names in a script, `*` stands for the items of an array
    pub pointer: String,
    /// The sibling attributes whose listed values make the value public
    pub public_when: HashMap<String, Vec<String>>,
}

impl OverlaySensitive {
    /// The path of the pointer without array items. An object and an array of them are interchangeable in a script.
    fn segments(&self) -> impl Iterator<Item = &str> {
        self.pointer.split('/').filter(|s| !s.is_empty() && *s != "*")
    }

    /// Does the pointer select a value at a path? Array items don't count, see `segments`.
    pub fn matches(&self, path: &[Arc<str>]) -> bool {
        self.segments().eq(path.iter().map(|s| &**s).filter(|s| *s != "*"))
    }
}

/// The paging of a function, as far as checks need it
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct OverlayPaging {
    /// The kind: `url`, `token`, `offset` or `page`
    pub kind: String,
    /// The option that `_next` sets, none for `url`
    pub option: Option<String>,
}

/// A function of a spec
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct OverlayFunction {
    /// The name in a script
    pub name: String,
    /// The grouping for documentation and completion
    pub family: Option<String>,
    /// The HTTP method, it decides the default effect
    pub method: Option<String>,
    /// The options
    pub options: Vec<OverlayAttribute>,
    /// What an option that is not listed does
    pub unknown: OverlayUnknownPolicy,
    /// The result columns
    pub columns: Vec<OverlayColumn>,
    /// The paging, if the function pages
    pub paging: Option<OverlayPaging>,
    /// Absent takes the default of the spec, null means none
    #[serde(deserialize_with = "present")]
    pub pending: Option<serde_json::Value>,
    /// The values that must be a `secret()`
    pub sensitive: Vec<OverlaySensitive>,
    /// The declared effect
    pub effect: Option<OverlayEffect>,
    /// The escape hatch: any option goes
    pub raw: bool,
}

/// Tell a null value from an absent field
fn present<'de, D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Option<serde_json::Value>, D::Error> {
    serde_json::Value::deserialize(deserializer).map(Some)
}

impl OverlayFunction {
    /// The effect, a write without a declaration unless the method only reads. A raw function can do anything.
    pub fn effect(&self) -> OverlayEffect {
        match (self.raw, self.effect, self.method.as_deref()) {
            (true, ..) => OverlayEffect::Write,
            (false, Some(effect), _) => effect,
            (false, None, Some(method)) if method.eq_ignore_ascii_case("GET") => OverlayEffect::Read,
            (false, None, _) => OverlayEffect::Write,
        }
    }

    /// What an option that is not listed does
    pub fn unknown_options(&self) -> OverlayUnknownPolicy {
        if self.raw { OverlayUnknownPolicy::Allow } else { self.unknown }
    }

    /// The standard options of the function
    pub fn standard_options(&self, spec: &OverlaySpec) -> Vec<&'static str> {
        let mut options = Vec::new();
        if self.paging.is_some() {
            options.push(OPTION_NEXT);
            if self.effect() == OverlayEffect::Read {
                options.push(OPTION_PAGES);
            }
        }
        if spec.has_pending(self) {
            options.push(OPTION_POLL);
            options.push(OPTION_WAIT);
        }
        options
    }
}

/// An overlay
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct OverlaySpec {
    /// The version of the format
    pub format: u32,
    /// The prefix of the functions
    pub namespace: String,
    /// The title of the service
    pub title: Option<String>,
    /// The default for functions that can answer before they finish
    pub pending: Option<serde_json::Value>,
    /// The named objects
    pub schemas: HashMap<String, OverlaySchema>,
    /// The functions
    pub functions: Vec<OverlayFunction>,
    /// The functions by name
    #[serde(skip)]
    functions_by_name: HashMap<String, usize>,
}

/// Is a name a plain identifier in lower case?
fn is_plain_lowercase(name: &str) -> bool {
    let mut bytes = name.bytes();
    bytes.next().is_some_and(|c| c.is_ascii_lowercase() || c == b'_') && bytes.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_')
}

/// Check the attributes of a function or a schema
fn check_attributes(owner: &str, attributes: &[OverlayAttribute], schemas: &HashMap<String, OverlaySchema>) -> Result<()> {
    for (i, attribute) in attributes.iter().enumerate() {
        if attribute.name.is_empty() {
            return Err(Error::invalid_argument(format!("{owner}: an attribute has no name")));
        }
        if attributes[..i].iter().any(|a| a.name.eq_ignore_ascii_case(&attribute.name)) {
            return Err(Error::invalid_argument(format!("{owner}: duplicate attribute {}", attribute.name)));
        }
        if let Some(schema) = attribute.schema.as_ref().filter(|s| !schemas.contains_key(*s)) {
            return Err(Error::invalid_argument(format!("{owner}.{}: unknown schema {schema}", attribute.name)));
        }
    }
    Ok(())
}

impl OverlaySpec {
    /// Read and check a spec
    pub fn parse(json: &str) -> Result<Self> {
        let mut spec: OverlaySpec =
            serde_json::from_str(json).map_err(|e| Error::invalid_argument(format!("invalid overlay: {e}")))?;
        if spec.format != OVERLAY_FORMAT {
            return Err(Error::invalid_argument(format!("unsupported overlay format {}", spec.format)));
        }
        if !is_plain_lowercase(&spec.namespace) {
            return Err(Error::invalid_argument(format!("invalid namespace {:?}", spec.namespace)));
        }
        for (name, schema) in &spec.schemas {
            check_attributes(name, &schema.attributes, &spec.schemas)?;
        }
        for (i, function) in spec.functions.iter().enumerate() {
            if !is_plain_lowercase(&function.name) {
                return Err(Error::invalid_argument(format!("invalid function name {:?}", function.name)));
            }
            if spec.functions_by_name.insert(function.name.clone(), i).is_some() {
                return Err(Error::invalid_argument(format!("duplicate function {}", function.name)));
            }
            check_attributes(&function.name, &function.options, &spec.schemas)?;
            // The standard options and columns start with an underscore
            if let Some(option) = function.options.iter().find(|o| o.name.starts_with('_')) {
                return Err(Error::invalid_argument(format!("{}: the name {} is reserved", function.name, option.name)));
            }
            if let Some(column) = function.columns.iter().find(|c| c.name.starts_with('_')) {
                return Err(Error::invalid_argument(format!("{}: the column {} is reserved", function.name, column.name)));
            }
        }
        Ok(spec)
    }

    /// A function by its lower-case name
    pub fn function(&self, name: &str) -> Option<&OverlayFunction> {
        self.functions_by_name.get(name).map(|&i| &self.functions[i])
    }

    /// A schema by name
    pub fn schema(&self, name: &str) -> Option<&OverlaySchema> {
        self.schemas.get(name)
    }

    /// Can a function answer before it finishes?
    pub fn has_pending(&self, function: &OverlayFunction) -> bool {
        let is_set = |value: &serde_json::Value| !value.is_null();
        match &function.pending {
            Some(pending) => is_set(pending),
            None => self.pending.as_ref().is_some_and(is_set),
        }
    }
}

/// The attribute that a name in a script selects. An unquoted name folds its case, a quoted one is exact.
pub fn find_attribute<'a>(attributes: &'a [OverlayAttribute], name: &str, quoted: bool) -> Option<&'a OverlayAttribute> {
    if quoted {
        attributes.iter().find(|a| a.name == name)
    } else {
        attributes.iter().find(|a| a.name.eq_ignore_ascii_case(name))
    }
}

/// A name without case and underscores: `batchSize` and `batch_size` are the same mistake
fn normalized(name: &str) -> Vec<u8> {
    name.bytes().filter(|&c| c != b'_').map(|c| c.to_ascii_lowercase()).collect()
}

/// The edit distance of two byte strings
fn edit_distance(l: &[u8], r: &[u8]) -> usize {
    let mut row: Vec<usize> = (0..=r.len()).collect();
    for (i, lc) in l.iter().enumerate() {
        let mut diagonal = row[0];
        row[0] = i + 1;
        for (j, rc) in r.iter().enumerate() {
            let cost = diagonal + usize::from(lc != rc);
            diagonal = row[j + 1];
            row[j + 1] = cost.min(row[j] + 1).min(row[j + 1] + 1);
        }
    }
    row[r.len()]
}

/// The candidate closest to a misspelled name, if one is close enough
pub fn closest_name<'a>(name: &str, candidates: impl Iterator<Item = &'a str>) -> Option<&'a str> {
    let name = normalized(name);
    let limit = (name.len() / 3).max(2);
    candidates
        .map(|candidate| (edit_distance(&name, &normalized(candidate)), candidate))
        .filter(|(distance, _)| *distance <= limit)
        .min_by_key(|(distance, candidate)| (*distance, *candidate))
        .map(|(_, candidate)| candidate)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn function(name: &str, extra: &str) -> String {
        format!(r#"{{"format": 1, "namespace": "t", "functions": [{{"name": "{name}"{extra}}}]}}"#)
    }

    #[test]
    fn rejects_invalid_specs() {
        assert!(OverlaySpec::parse("{").is_err());
        assert!(OverlaySpec::parse(r#"{"format": 2, "namespace": "t"}"#).is_err());
        assert!(OverlaySpec::parse(r#"{"format": 1, "namespace": "T"}"#).is_err());
        assert!(OverlaySpec::parse(&function("F", "")).is_err());
        assert!(OverlaySpec::parse(&function("f", r#", "options": [{"name": "_next"}]"#)).is_err());
        assert!(OverlaySpec::parse(&function("f", r#", "columns": [{"name": "_raw"}]"#)).is_err());
        assert!(OverlaySpec::parse(&function("f", r#", "options": [{"name": "a", "schema": "Nope"}]"#)).is_err());
        assert!(OverlaySpec::parse(&function("f", r#", "options": [{"name": "a"}, {"name": "A"}]"#)).is_err());
    }

    #[test]
    fn ignores_what_the_runtime_reads() {
        let spec = OverlaySpec::parse(&function("f", r#", "path": "/x", "host": "api", "rows": "", "billed": true"#)).unwrap();
        assert!(spec.function("f").is_some());
    }

    #[test]
    fn effects() {
        let effect = |extra: &str| {
            let spec = OverlaySpec::parse(&function("f", extra)).unwrap();
            spec.function("f").unwrap().effect()
        };
        assert_eq!(effect(r#", "method": "GET""#), OverlayEffect::Read);
        assert_eq!(effect(r#", "method": "POST""#), OverlayEffect::Write);
        assert_eq!(effect(r#", "method": "POST", "effect": "read""#), OverlayEffect::Read);
        assert_eq!(effect(""), OverlayEffect::Write);
        assert_eq!(effect(r#", "method": "GET", "effect": "read", "raw": true"#), OverlayEffect::Write);
    }

    #[test]
    fn pending_follows_the_default_of_the_spec() {
        let spec = OverlaySpec::parse(
            r#"{"format": 1, "namespace": "t", "pending": {"status": 202}, "functions": [
                {"name": "a"}, {"name": "b", "pending": null}
            ]}"#,
        )
        .unwrap();
        assert!(spec.has_pending(spec.function("a").unwrap()));
        assert!(!spec.has_pending(spec.function("b").unwrap()));
    }

    #[test]
    fn sensitive_pointers_ignore_array_items() {
        let sensitive = OverlaySensitive { pointer: "/credentials/*/value".to_string(), ..Default::default() };
        let path = |p: &[&str]| p.iter().map(|s| Arc::<str>::from(*s)).collect::<Vec<_>>();
        assert!(sensitive.matches(&path(&["credentials", "*", "value"])));
        assert!(sensitive.matches(&path(&["credentials", "value"])));
        assert!(!sensitive.matches(&path(&["credentials"])));
        assert!(!sensitive.matches(&path(&["credentials", "*", "name"])));
    }

    #[test]
    fn finds_close_names() {
        let names = ["batch_size", "offset", "segment_id"];
        assert_eq!(closest_name("batchsize", names.iter().copied()), Some("batch_size"));
        assert_eq!(closest_name("batchSize", names.iter().copied()), Some("batch_size"));
        assert_eq!(closest_name("ofset", names.iter().copied()), Some("offset"));
        assert_eq!(closest_name("completely_else", names.iter().copied()), None);
    }
}
