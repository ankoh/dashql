use std::fmt;

/// Data type detected for a CSV field.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum Type {
    /// Unsigned integer (non-negative whole number).
    Unsigned,
    /// Signed integer (whole number, possibly negative).
    Signed,
    /// Floating point number.
    Float,
    /// Boolean value (true/false, yes/no, 0/1, etc.).
    Boolean,
    /// Date value (without time component).
    Date,
    /// `DateTime` value (date with time component).
    DateTime,
    /// Null/empty value.
    NULL,
    /// Text/string value (fallback type).
    #[default]
    Text,
}

impl fmt::Display for Type {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Type::Unsigned => write!(f, "Unsigned"),
            Type::Signed => write!(f, "Signed"),
            Type::Float => write!(f, "Float"),
            Type::Boolean => write!(f, "Boolean"),
            Type::Date => write!(f, "Date"),
            Type::DateTime => write!(f, "DateTime"),
            Type::NULL => write!(f, "NULL"),
            Type::Text => write!(f, "Text"),
        }
    }
}

impl Type {
    /// Number of variants in the Type enum.
    pub const COUNT: usize = 8;

    /// Returns the index for this type (0-7), suitable for array indexing.
    /// This index is based on type priority (see `priority()`), not enum
    /// declaration order: NULL=0, Boolean=1, Unsigned=2, Signed=3, Float=4,
    /// Date=5, DateTime=6, Text=7.
    #[inline]
    pub const fn as_index(&self) -> usize {
        self.priority() as usize
    }

    /// Returns true if this type is numeric.
    #[inline]
    pub const fn is_numeric(&self) -> bool {
        matches!(self, Type::Unsigned | Type::Signed | Type::Float)
    }

    /// Returns true if this type is temporal.
    #[inline]
    pub const fn is_temporal(&self) -> bool {
        matches!(self, Type::Date | Type::DateTime)
    }

    /// Returns the type priority for type inference.
    /// Higher priority types are preferred when merging types.
    pub const fn priority(&self) -> u8 {
        match self {
            Type::NULL => 0,
            Type::Boolean => 1,
            Type::Unsigned => 2,
            Type::Signed => 3,
            Type::Float => 4,
            Type::Date => 5,
            Type::DateTime => 6,
            Type::Text => 7,
        }
    }

    /// Merge two types, returning the most general type that can represent both.
    pub fn merge(self, other: Type) -> Type {
        if self == other {
            return self;
        }

        // NULL can be promoted to any type
        if self == Type::NULL {
            return other;
        }
        if other == Type::NULL {
            return self;
        }

        // Numeric type promotion
        match (self, other) {
            (Type::Unsigned, Type::Signed) | (Type::Signed, Type::Unsigned) => Type::Signed,
            (Type::Unsigned, Type::Float)
            | (Type::Float, Type::Unsigned)
            | (Type::Signed, Type::Float)
            | (Type::Float, Type::Signed) => Type::Float,
            (Type::Date, Type::DateTime) | (Type::DateTime, Type::Date) => Type::DateTime,
            // Everything else becomes Text
            _ => Type::Text,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_type_merge() {
        assert_eq!(Type::Unsigned.merge(Type::Unsigned), Type::Unsigned);
        assert_eq!(Type::Unsigned.merge(Type::Signed), Type::Signed);
        assert_eq!(Type::Unsigned.merge(Type::Float), Type::Float);
        assert_eq!(Type::NULL.merge(Type::Unsigned), Type::Unsigned);
        assert_eq!(Type::Date.merge(Type::DateTime), Type::DateTime);
        assert_eq!(Type::Boolean.merge(Type::Text), Type::Text);
    }
}
