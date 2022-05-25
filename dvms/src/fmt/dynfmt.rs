use super::formatter::Formatter;
use super::types::FmtError;
use super::types::Result;
use std::collections::HashMap;
use std::fmt;
use std::fmt::Write;
use std::hash::Hash;
use std::str::FromStr;

pub fn dynfmt<K, T: fmt::Display>(fmtstr: &str, unnamed: &[T], named: &HashMap<K, T>) -> Result<String>
where
    K: Hash + Eq + FromStr,
{
    let formatter = |next_fmt_id: usize, mut fmt: Formatter| {
        let v = if fmt.key.is_empty() {
            if next_fmt_id >= unnamed.len() {
                return Err(FmtError::KeyError(format!(
                    "expected {} unnamed argument(s), have {}",
                    next_fmt_id + 1,
                    unnamed.len()
                )));
            }
            &unnamed[next_fmt_id]
        } else {
            let k: K = match fmt.key.parse() {
                Ok(k) => k,
                Err(_) => {
                    return Err(FmtError::KeyError(format!("invalid key: {}", fmt.key)));
                }
            };
            match named.get(&k) {
                Some(v) => v,
                None => {
                    return Err(FmtError::KeyError(format!("missing key: {}", fmt.key)));
                }
            }
        };
        fmt.str(v.to_string().as_str())
    };
    dynfmt_map(fmtstr, &formatter)
}

/// Format a string given the string and a closure that uses a Formatter
fn dynfmt_map<F>(fmtstr: &str, f: &F) -> Result<String>
where
    F: Fn(usize, Formatter) -> Result<()>,
{
    let mut next_fmt_id = 0;
    let mut out = String::with_capacity(fmtstr.len() * 2);
    let mut bytes_read: usize = 0;
    let mut opening_brace: usize = 0;
    let mut closing_brace: bool = false;
    let mut reading_fmt = false;
    let mut remaining = fmtstr;
    for c in fmtstr.chars() {
        bytes_read += c.len_utf8();
        if c == '{' {
            if reading_fmt && opening_brace == bytes_read - 2 {
                // found {{
                out.push(c);
                reading_fmt = false;
            } else if !reading_fmt {
                // found a first {
                reading_fmt = true;
                opening_brace = bytes_read - 1;
            } else {
                // found a { after finding an opening brace, error!
                out.clear();
                out.write_str("extra { found").unwrap();
                return Err(FmtError::Invalid(out));
            }
        } else if c == '}' {
            if !reading_fmt && !closing_brace {
                // found a '}' that isn't after a '{'
                closing_brace = true;
            } else if closing_brace {
                // found "}}"
                out.push(c);
                closing_brace = false;
            } else {
                // found a format string
                // discard before opening brace
                let (_, r) = remaining.split_at(opening_brace);

                // get the fmt pattern and remaining
                let (fmt_pattern, r) = r.split_at(bytes_read - opening_brace);
                remaining = r;

                // discard the braces
                let (_, fmt_pattern) = fmt_pattern.split_at(1);
                let (fmt_pattern, _) = fmt_pattern.split_at(fmt_pattern.len() - 1);
                // use the closure to write the formatted string
                let fmt = Formatter::create(fmt_pattern, &mut out)?;
                f(next_fmt_id, fmt)?;
                next_fmt_id += 1;
                reading_fmt = false;
                bytes_read = 0;
            }
        } else if closing_brace {
            return Err(FmtError::Invalid("Single '}' encountered in format string".to_string()));
        } else if !reading_fmt {
            out.push(c)
        } // else we are currently reading a format string, so don't push
    }
    if closing_brace {
        return Err(FmtError::Invalid("Single '}' encountered in format string".to_string()));
    } else if reading_fmt {
        return Err(FmtError::Invalid("Expected '}' before end of string".to_string()));
    }
    out.shrink_to_fit();
    Ok(out)
}

#[cfg(test)]
mod test {
    #![allow(unused_variables)]

    use super::*;
    use std::collections::HashMap;
    use std::fmt;

    macro_rules! matches {
        ($e:expr, $p:pat) => {
            match $e {
                $p => true,
                _ => false,
            }
        };
    }

    fn run_tests<T: fmt::Display, F>(
        values: &Vec<(&str, &str, u8)>,
        unnamed: &[T],
        named: &HashMap<String, T>,
        call: &F,
    ) where
        F: Fn(&str, &[T], &HashMap<String, T>) -> Result<String>,
    {
        for &(fmtstr, expected, expect_err) in values.iter() {
            let result = call(fmtstr, unnamed, named);
            let mut failure = match expect_err {
                0 => result.is_err(),
                1 => !matches!(result, Err(FmtError::Invalid(_))),
                2 => !matches!(result, Err(FmtError::KeyError(_))),
                3 => !matches!(result, Err(FmtError::TypeError(_))),
                c @ _ => panic!("error code {} DNE", c),
            };
            let result = match result {
                Err(e) => e.to_string(),
                Ok(s) => s,
            };
            if !failure && expect_err == 0 {
                failure = !(expected == result);
            }

            if failure {
                println!("FAIL:");
                println!("     input: {:?}", fmtstr);
                println!("    output: {:?}", result);
                if expect_err != 0 {
                    let expected = match expect_err {
                        1 => "FmtError::Invalid",
                        2 => "FmtError::KeyError",
                        3 => "FmtError::TypeError",
                        _ => unreachable!(),
                    };
                    println!("  expected: {}", expected)
                } else {
                    println!("  expected: {:?}", expected);
                }
                assert!(false);
            }
        }
    }

    #[test]
    fn test_values() {
        let mut named: HashMap<String, String> = HashMap::new();
        let too_long = "toooloooong".to_string();
        named.insert("x".to_string(), "X".to_string());
        named.insert("long".to_string(), too_long.clone()); // len=10
        named.insert("hi".to_string(), "hi".to_string());

        // format, expected, error
        // error codes: 0 == no error, 1 == Invalid, 2 == KeyError
        let values: Vec<(&str, &str, u8)> = vec![
            // simple positioning
            ("{x}", "X", 0),
            ("{x:}", "X", 0),
            ("{x:3}", "X  ", 0),
            ("{x:>3}", "  X", 0),
            ("{x:<3}", "X  ", 0),
            ("{x:^3}", " X ", 0),
            ("{x:^4}", " X  ", 0),
            // extra text
            (" {x}yz", " Xyz", 0),
            (" hi {x:^4}-you rock", " hi  X  -you rock", 0),
            // fill confusion
            ("{x:10}", "X         ", 0),
            ("{x:>10}", "         X", 0),
            ("{x:0<5}", "X0000", 0),
            ("{x:0>5}", "0000X", 0),
            ("{long:.3}", "too", 0),
            ("{long:5.3}", "too  ", 0),
            ("{long:>5.3}", "  too", 0),
            ("{long:5.7}", "toooloo", 0),
            ("{long:<5.7}", "toooloo", 0),
            ("{long:>5.7}", "toooloo", 0),
            ("{long:^5.7}", "toooloo", 0),
            ("{long:<}", &too_long, 0),
            ("{long:<<}", &too_long, 0),
            ("{long:<<5}", &too_long, 0),
            // valid types
            ("{x:<4s}", "X   ", 0),
            // escape
            ("{{}}", "{}", 0),
            ("{{long}}", "{long}", 0),
            ("{{{x}}}", "{X}", 0),
            // fun
            ("{x:<>}", "X", 0),
            ("{x:<>3}", "<<X", 0),
            ("{{}}", "{}", 0),
            ("{{{x}}}", "{X}", 0),
            ("{{{x}{{{{{{", "{X{{{", 0),
            ("{x}}}}}", "X}}", 0),
            // invalid fmt
            ("{xxx:  <88.3}", "", 1),
            // invalid escape
            ("}", "", 1),
            ("{{}}}", "", 1),
            ("hi } there", "", 1),
            ("hi }", "", 1),
            ("w { ho", "", 1),
            // invalid keys
            ("{what}", "{}", 2),
            ("{who}", "{}", 2),
            ("{x} {where}", "{}", 2),
            // invalid types
            ("{x:<<<}", "", 3),
            ("{x:*}", "", 3),
            ("{x::}", "", 3),
            ("{x:#}", "", 3),
            ("{x:<4n}", "", 3),
            ("{x:<4d}", "", 3),
            ("{x:,}", "", 3),
            ("{x:<-10}", "", 3),
            // TODO
            ("{x:0=5}", "00X00", 1),
            ("{x:03}", "00X", 1),
        ];

        run_tests(&values, &[], &named, &dynfmt);
    }

    #[test]
    /// test using integers directly into format (uses Display)
    fn test_ints_basic() {
        let mut named: HashMap<String, u64> = HashMap::new();
        named.insert("x".to_string(), 6);
        named.insert("long".to_string(), 100000); // len=10
        named.insert("hi".to_string(), 42);

        // format, expected, error
        // error codes: 0 == no error, 1 == Invalid, 2 == KeyError
        let values: Vec<(&str, &str, u8)> = vec![
            // simple positioning
            ("{x}", "6", 0),
            ("{long}", "100000", 0),
            (
                " the answer is {hi}, haven't you read anything?",
                " the answer is 42, haven't you read anything?",
                0,
            ),
        ];

        run_tests(&values, &[], &named, &dynfmt);
    }

    #[test]
    fn test_ignore_missing() {
        let mut named: HashMap<String, String> = HashMap::new();
        named.insert("x".to_string(), "X".to_string());
        let values: Vec<(&str, &str, u8)> = vec![
            // simple positioning
            ("{y}", "{y}", 0),
            ("{y} {x}", "{y} X", 0),
            ("{x} {longish:<32.3} {x} is nice", "X {longish:<32.3} X is nice", 0),
        ];
        let f = |_fmt_id: usize, mut fmt: Formatter| match named.get(fmt.key) {
            Some(v) => fmt.str(v),
            None => fmt.skip(),
        };

        let strfmt_ignore = |fmtstr: &str, unnamed: &[String], named: &HashMap<String, String>| -> Result<String> {
            dynfmt_map(fmtstr, &f)
        };
        run_tests(&values, &[], &named, &strfmt_ignore);
    }

    macro_rules! test_float {
        ($($name:ident $t:ident),*) => ($(
            #[test]
            fn $name() {
                let mut named: HashMap<String, $t> = HashMap::new();
                named.insert("x".to_string(), 42.4242);
                named.insert("y".to_string(), -100.11111);
                named.insert("z".to_string(), 0.);
                let values: Vec<(&str, &str, u8)> = vec![
                    // simple valid
                    ("{x}", "42.4242", 0),
                    ("{x:.2}", "42.42", 0),
                    ("{x:<7.2}", "42.42  ", 0),
                    ("{x:.2e}", "4.24e1", 0),
                    ("{x:.2E}", "4.24E1", 0),
                    ("{x:+}", "+42.4242", 0),
                    ("{y:.2E}", "-1.00E2", 0),
                    ("{y:+.2E}", "-1.00E2", 0),
                    ("{z:+.2E}", "+0.00E0", 0),

                    // invalid
                    ("{x:s}", "", 3),
                    ("{x:#}", "", 3),

                    // TODO
                    ("{x:+010.2}", "+0042.4242", 1),
                ];
                let f = |fmt_id: usize, mut fmt: Formatter| {
                    match named.get(fmt.key) {
                        Some(v) => fmt.$t(*v),
                        None => panic!(),
                    }
                };

                let dynfmt_float = |fmtstr: &str, unnamed: &[$t], named: &HashMap<String, $t>| -> Result<String> {
                    dynfmt_map(fmtstr, &f)
                };
                run_tests(&values, &[], &named, &dynfmt_float);
             }
        )*)
    }

    test_float!(test_f32 f32, test_f64 f64);

    macro_rules! test_uint {
        ($($name:ident $t:ident),*) => ($(
            #[test]
            fn $name() {
                let mut named: HashMap<String, $t> = HashMap::new();
                named.insert("x".to_string(), 42);
                named.insert("y".to_string(), 0);
                let values: Vec<(&str, &str, u8)> = vec![
                    ("{x}", "42", 0),
                    ("{x:<7}", "42     ", 0),
                    ("{x:>7}", "     42", 0),
                    ("{x:^7}", "  42   ", 0),
                    ("{x:x}", "2a", 0),
                    ("{x:X}", "2A", 0),
                    ("{x:+x}", "+2a", 0),
                    ("{x:#x}", "0x2a", 0),
                    ("{x:#X}", "0x2A", 0),
                    ("{x:b}", "101010", 0),
                    ("{x:#b}", "0b101010", 0),
                    ("{x:o}", "52", 0),
                    ("{x:#o}", "0o52", 0),

                    ("{x:+}", "+42", 0),
                    ("{y:-}", "0", 0),
                    ("{y:+}", "+0", 0),

                    // invalid
                    ("{x:.2}", "", 3),
                    ("{x:s}", "", 3),

                    // TODO
                    ("{x:+010}", "+000000042", 1),
                ];
                let f = |fmt_id: usize, mut fmt: Formatter| {
                    match named.get(fmt.key) {
                        Some(v) => fmt.$t(*v),
                        None => panic!(),
                    }
                };

                let dynfmt_int = |fmtstr: &str, unnamed: &[$t], named: &HashMap<String, $t>| -> Result<String> {
                    dynfmt_map(fmtstr, &f)
                };
                run_tests(&values, &[], &named, &dynfmt_int);
             }
        )*)
    }

    macro_rules! test_int {
        ($($name:ident $t:ident),*) => ($(
            #[test]
            fn $name() {
                let mut named: HashMap<String, $t> = HashMap::new();
                named.insert("x".to_string(), 42);
                named.insert("y".to_string(), -100);
                named.insert("z".to_string(), 0);
                let values: Vec<(&str, &str, u8)> = vec![
                    // simple valid
                    ("{x}", "42", 0),
                    ("{x:<7}", "42     ", 0),
                    ("{x:X}", "2A", 0),
                    ("{x:#x}", "0x2a", 0),
                    ("{x:#X}", "0x2A", 0),
                    ("{x:b}", "101010", 0),
                    ("{x:#b}", "0b101010", 0),
                    ("{x:o}", "52", 0),
                    ("{x:#o}", "0o52", 0),

                    ("{x:+}", "+42", 0),
                    ("{y}", "-100", 0),
                    ("{y:+}", "-100", 0),
                    ("{z}", "0", 0),
                    ("{z:-}", "0", 0),
                    ("{z:+}", "+0", 0),

                    // invalid
                    ("{x:.2}", "", 3),
                    ("{x:s}", "", 3),

                    // TODO
                    ("{x:+010}", "+000000042", 1),
                ];
                let f = |fmt_id: usize, mut fmt: Formatter| {
                    match named.get(fmt.key) {
                        Some(v) => fmt.$t(*v),
                        None => panic!(),
                    }
                };

                let dynfmt_uint = |fmtstr: &str, unnamed: &[$t], named: &HashMap<String, $t>| -> Result<String> {
                    dynfmt_map(fmtstr, &f)
                };
                run_tests(&values, &[], &named, &dynfmt_uint);
            }
        )*)
    }

    test_uint!(test_u8 u8, test_u16 u16, test_u32 u32, test_u64 u64, test_usize usize);
    test_int!(test_i8 i8, test_i16 i16, test_i32 i32, test_i64 i64, test_isize isize);
}
