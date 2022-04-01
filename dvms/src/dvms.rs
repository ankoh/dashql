mod error;
mod grammar;
mod proto;

#[cfg(test)]
mod test;

fn main() {
    grammar::parse("select 1;").ok();
    println!("Hello, world!");
}
