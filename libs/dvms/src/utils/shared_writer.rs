use std::cell::RefCell;
use std::io::Write;
use std::rc::Rc;

pub struct SharedWriter<W: Write> {
    writer: Rc<RefCell<W>>,
}

impl<W: Write> SharedWriter<W> {
    pub fn from_writer(writer: W) -> Self {
        Self {
            writer: Rc::new(RefCell::new(writer)),
        }
    }
}

impl<W: Write> Write for SharedWriter<W> {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let mut writer = self.writer.borrow_mut();
        writer.write(buf)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        let mut writer = self.writer.borrow_mut();
        writer.flush()
    }
}

impl<W: Write> Clone for SharedWriter<W> {
    fn clone(&self) -> Self {
        Self {
            writer: self.writer.clone(),
        }
    }
}
