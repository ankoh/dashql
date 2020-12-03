extern "C" {
    #[no_mangle]
    fn bar(bar: &u32) -> u32;
}

// Called when the wasm module is instantiated
#[no_mangle]
extern "C" fn foo() -> u32 {
    let baam: Box<u32> = Box::new(0);
    unsafe {
        bar(&baam);
    }
    add(1, 2)
}

#[no_mangle]
fn add(a: u32, b: u32) -> u32 {
    a + b
}

