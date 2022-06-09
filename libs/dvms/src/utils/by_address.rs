use core::cmp::Ordering;
use core::convert::AsRef;
use core::hash::{Hash, Hasher};
use core::ops::{Deref, DerefMut};

#[derive(Copy, Clone, Debug, Default)]
pub struct ByAddress<T>(pub T)
where
    T: ?Sized + Deref;

impl<T> ByAddress<T>
where
    T: ?Sized + Deref,
{
    fn addr(&self) -> *const T::Target {
        &*self.0
    }
}

impl<T> PartialEq for ByAddress<T>
where
    T: ?Sized + Deref,
{
    fn eq(&self, other: &Self) -> bool {
        self.addr() == other.addr()
    }
}
impl<T> Eq for ByAddress<T> where T: ?Sized + Deref {}
impl<T> Ord for ByAddress<T>
where
    T: ?Sized + Deref,
{
    fn cmp(&self, other: &Self) -> Ordering {
        self.addr().cmp(&other.addr())
    }
}
impl<T> PartialOrd for ByAddress<T>
where
    T: ?Sized + Deref,
{
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.addr().cmp(&other.addr()))
    }
}
impl<T> Hash for ByAddress<T>
where
    T: ?Sized + Deref,
{
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.addr().hash(state)
    }
}
impl<T> Deref for ByAddress<T>
where
    T: ?Sized + Deref,
{
    type Target = T::Target;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}
impl<T> DerefMut for ByAddress<T>
where
    T: ?Sized + DerefMut,
{
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0
    }
}
impl<T, U> AsRef<U> for ByAddress<T>
where
    T: ?Sized + Deref + AsRef<U>,
{
    fn as_ref(&self) -> &U {
        self.0.as_ref()
    }
}
impl<T, U> AsMut<U> for ByAddress<T>
where
    T: ?Sized + Deref + AsMut<U>,
{
    fn as_mut(&mut self) -> &mut U {
        self.0.as_mut()
    }
}
impl<T> From<T> for ByAddress<T>
where
    T: Deref,
{
    fn from(t: T) -> ByAddress<T> {
        ByAddress(t)
    }
}
