use crate::grammar::Program;

pub struct TaskContext<'a> {
    program: &'a Program<'a>,
}
