fn main() {

    for x in /* some comment */ 0..5 {
        println!("zero to five: {}", x);
    }

    /* Some code example in a comment:
       for y in 1..3 {
          println("{}", y);
       }
    */

    let for_ = 123;

    let mystr = r#"this looks like a for i in 1..100 { println("{}", i); } loop but is not one"#;
    println!("{}", mystr);

    for
    z // some other comment
    in 5..10 {
        println!("{}", z);
    }

}