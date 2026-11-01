//! The dataflow layout snapshots: boxes of statement rows and the edges between their rows in, the boxes out.
//!
//! ```yaml
//! - name: Chain
//!   boxes:
//!     - name: orders
//!       rows: 3           # the statements, 1 if absent
//!       chart: 1          # the statement whose chart follows its row
//!       collapsed: true
//!       fixed: [400, 80]
//!     - name: report
//!   edges:
//!     - from: orders.2    # <box>.<statement>, a box alone is its statement 0
//!       to: report
//!   expected:
//!     orders: [400, 80, 280, 32]   # x, y, width, height
//!     report: [776, 64, 280, 80]
//! ```

use super::Map;
use crate::ryml::Node;
use yaml_rust2::Yaml;

/// A box of a layout fixture
#[derive(Clone, Debug, Default, PartialEq)]
pub struct LayoutFixtureBox {
    pub name: String,
    pub rows: u32,
    pub chart: Option<u32>,
    pub collapsed: bool,
    pub fixed: Option<(f64, f64)>,
}

/// A layout fixture
#[derive(Clone, Debug, Default, PartialEq)]
pub struct LayoutFixture {
    pub boxes: Vec<LayoutFixtureBox>,
    /// (from box, from statement, to box, to statement)
    pub edges: Vec<(u32, u32, u32, u32)>,
}

fn number(value: &Yaml) -> Option<f64> {
    value.as_i64().map(|v| v as f64).or_else(|| value.as_f64())
}

fn count(value: &Yaml, key: &str, name: &str) -> Result<Option<u32>, String> {
    match value {
        Yaml::BadValue => Ok(None),
        _ => value.as_i64().and_then(|v| u32::try_from(v).ok()).map(Some).ok_or_else(|| format!("layout box {name}: invalid {key}")),
    }
}

impl LayoutFixture {
    /// Read a fixture of a snapshot file
    pub fn from_yaml(fixture: &Yaml) -> Result<Self, String> {
        let mut boxes = Vec::new();
        for b in fixture["boxes"].as_vec().into_iter().flatten() {
            let name = b["name"].as_str().ok_or("layout box without name")?.to_string();
            let fixed = match b["fixed"].as_vec().map(Vec::as_slice) {
                None => None,
                Some([x, y]) => Some((number(x).ok_or("invalid fixed x")?, number(y).ok_or("invalid fixed y")?)),
                Some(_) => return Err(format!("layout box {name}: fixed is [x, y]")),
            };
            boxes.push(LayoutFixtureBox {
                rows: count(&b["rows"], "rows", &name)?.unwrap_or(1),
                chart: count(&b["chart"], "chart", &name)?,
                collapsed: b["collapsed"].as_bool().unwrap_or(false),
                fixed,
                name,
            });
        }
        let port = |text: &str| -> Result<(u32, u32), String> {
            let (name, statement) = match text.rsplit_once('.') {
                Some((name, statement)) => (name, statement.parse::<u32>().map_err(|_| format!("invalid layout port {text}"))?),
                None => (text, 0),
            };
            let index = boxes.iter().position(|b| b.name == name).ok_or_else(|| format!("unknown layout box {name}"))?;
            Ok((index as u32, statement))
        };
        let mut edges = Vec::new();
        for e in fixture["edges"].as_vec().into_iter().flatten() {
            let from = e["from"].as_str().ok_or("layout edge without from")?;
            let to = e["to"].as_str().ok_or("layout edge without to")?;
            let ((from_box, from_statement), (to_box, to_statement)) = (port(from)?, port(to)?);
            edges.push((from_box, from_statement, to_box, to_statement));
        }
        Ok(LayoutFixture { boxes, edges })
    }

    /// Read a fixture of a template
    pub fn from_node(fixture: &Node) -> Result<Self, String> {
        Self::from_yaml(&fixture.to_yaml())
    }

    /// Encode the boxes of a layout as `<name>: [x, y, width, height]`
    pub fn encode(&self, boxes: &[(f64, f64, f64, f64)]) -> Node {
        let mut out = Map::new();
        for (b, &(x, y, w, h)) in self.boxes.iter().zip(boxes) {
            out.insert(&b.name, Node::flow_seq([x, y, w, h].iter().map(|v| Node::int(v.round() as i64)).collect()));
        }
        out.into_node()
    }
}
