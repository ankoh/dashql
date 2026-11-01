//! The dataflow snapshots (snapshots/dataflow/*.yaml).

use dashql_snapshots::encode::dataflow::encode_fixture;
use dashql_snapshots::{compare, load_category, run, Arguments, Failed, Trial};

fn main() {
    let args = Arguments::from_args();
    let mut trials = Vec::new();
    for case in load_category("dataflow").expect("cannot load dataflow snapshots") {
        trials.push(Trial::test(case.trial_name(), move || {
            let expected = case.expected().ok_or_else(|| Failed::from("missing expected"))?;
            let actual = encode_fixture(&case.node).map_err(Failed::from)?;
            compare(expected, &actual).map_err(Failed::from)
        }));
    }
    run(&args, trials).exit();
}
