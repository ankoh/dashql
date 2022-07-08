pub mod u8 {
    use std::sync::atomic::{AtomicU8, Ordering};

    use serde::{Deserializer, Serializer};

    pub fn serialize<S>(value: &AtomicU8, ser: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        ser.serialize_u8(value.load(Ordering::SeqCst))
    }

    pub fn deserialize<'de, D>(de: D) -> Result<AtomicU8, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value: u8 = serde::de::Deserialize::deserialize(de)?;
        Ok(AtomicU8::new(value))
    }
}
