var a = any``;
a = "hello";  // OK
a = 1; // also OK because `a` is still type `any`
var b = a + 2;   // error: mixed operand types: 'any' and 'number'