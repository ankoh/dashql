use std::fmt::Write;
use std::string::String;

use super::formatter::Formatter;
use super::types::*;

fn write_char(f: &mut Formatter, c: char, n: usize) {
    for _ in 0..n {
        f.write_char(c).unwrap();
    }
}

#[test]
fn test_write_char() {
    let mut s = String::new();
    s.write_str("h ").unwrap();
    {
        let mut f = Formatter::create("{}", &mut s).unwrap();
        write_char(&mut f, 'f', 3);
    }
    assert!(s == "h fff");
}

fn write_from<I>(fmt: &mut Formatter, f: I, n: usize) -> usize
where
    I: Iterator<Item = char>,
{
    // Exhaust f or run out of n, return chars written
    if n == 0 {
        return 0;
    }
    let mut n_written: usize = 0;
    for c in f {
        fmt.write_char(c).unwrap();
        n_written += 1;
        if n_written == n {
            return n_written;
        }
    }
    n_written
}

#[test]
fn test_write_from() {
    let mut s = String::new();
    s.write_str("h ").unwrap();
    {
        let mut f = Formatter::create("{}", &mut s).unwrap();
        write_from(&mut f, "fff".chars(), 5);
    }
    assert!(s == "h fff");
    {
        let mut f = Formatter::create("{}", &mut s).unwrap();
        write_from(&mut f, "xxxx".chars(), 2);
    }
    assert!(s == "h fffxx");
    {
        let mut f = Formatter::create("{}", &mut s).unwrap();
        write_from(&mut f, "333".chars(), 3);
    }
    assert!(s == "h fffxx333");
    s.clear();
    {
        let mut f = Formatter::create("{}", &mut s).unwrap();
        write!(f, "hello").unwrap();
    }
    assert!(s == "hello");
}

/// Implement formatting of strings
impl<'a, 'b> Formatter<'a, 'b> {
    pub fn str(&mut self, s: &str) -> Result<()> {
        self.set_default_align(Alignment::Left);
        if !(self.ty() == None || self.ty() == Some('s')) {
            let mut msg = String::new();
            write!(msg, "Unknown format code {:?} for object of type 'str'", self.ty()).unwrap();
            return Err(FmtError::TypeError(msg));
        } else if self.alternate() {
            return Err(FmtError::TypeError(
                "Alternate form (#) not allowed in string \
                                            format specifier"
                    .to_string(),
            ));
        } else if self.thousands() {
            return Err(FmtError::TypeError("Cannot specify ',' with 's'".to_string()));
        } else if self.sign().is_unspecified() {
            return Err(FmtError::TypeError(
                "Sign not allowed in string format specifier".to_string(),
            ));
        }
        self.str_unchecked(s)
    }

    /// Do the same as `str` but do not check the format string for errors.
    /// This gives a moderate performance boost.
    /// This isn't exactly unsafe, it just ends up ignoring extranious format
    /// specifiers
    /// For example, {x:<-#10} should technically be formatting an int, but ignoring the
    /// integer specific formatting is probably not the end of the world
    /// This can also be used by the `u64` etc methods to finish their formatting while
    /// still using the str formatter for width and alignment
    pub fn str_unchecked(&mut self, s: &str) -> Result<()> {
        let fill = self.fill();
        let width = self.width();
        let precision = self.precision();
        // precision will limit length
        let len = match precision {
            Some(p) => {
                if p < s.len() {
                    p
                } else {
                    s.len()
                }
            }
            None => s.len(),
        };

        let mut chars = s.chars();
        let mut pad: usize = 0;
        if let Some(mut width) = width {
            if width > len {
                let align = self.align();
                match align {
                    Alignment::Left => pad = width - len,
                    Alignment::Center => {
                        width -= len;
                        pad = width / 2;
                        write_char(self, fill, pad);
                        pad += width % 2;
                    }
                    Alignment::Right => {
                        write_char(self, fill, width - len);
                    }
                    Alignment::Equal => {
                        return Err(FmtError::Invalid(
                            "sign aware zero padding and Align '=' not yet supported".to_string(),
                        ))
                    }
                    Alignment::Unspecified => unreachable!(),
                }
            }
        }
        write_from(self, &mut chars, len);
        write_char(self, fill, pad);
        Ok(())
    }
}
