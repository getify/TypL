"use strict";
var path = require("path");
var Typl = require(path.join(__dirname,"..","lib"));

QUnit.test( "Checker: API", function test(assert){
	assert.expect( 1 );
	assert.ok( _isFunction( Typl.Checker.check ), "check(..)" );
} );

QUnit.test( "Checker: #6 number sub-types", function test(assert){
	assert.expect(2);
	let code  = `var a = int\`3\`;
	a = 4;														// error, can't assign number to int
	
	var b = 5;
	b = int\`6\`;											// no error
	
	var c = finite\`7\`;
	b = c;														// no error
	c = b;														// error can't assign number to finite`

	let {outputMessages} = Typl.Checker.  check(code, {verbose:false});
	let errors = outputMessages.filter(m => m.type == "error")
	assert.equal(outputMessages.length, 5, 'total output length');
	assert.equal(errors.length, 2, 'num errors');
} );

QUnit.test( "Checker: #7 enforce bool type check in conditionals", function test(assert){
	assert.expect(2);
	let code  = `var i = 3 > 9;	// becomes bool but with error
	function foo(){
		return "ddd";										// foo returns string
	}
	
	function bar(){
		return "d" + 3 > 9;
	}
	
	if(i){}														// pass
	while(i){}												// pass
	do{} while(i)											// pass
	let a = i ? 1 : 0;								// pass
	
	if(foo()){}												// error
	while(foo()){}										// error
	do{} while(foo())									// error
	let b = foo() ? 1 : 0;						// error`

	let {outputMessages} = Typl.Checker.check(code, {verbose:false});
	let errors = outputMessages.filter(m => m.type == "error")
	assert.equal(outputMessages.length, 18, 'total output length');
	assert.equal(errors.length, 6, 'num errors');
} );

QUnit.test( "Checker: #8 any", function test(assert){
	assert.expect(2);
	let code  = `var a = any\`\`;
	a = "hello";											// OK
	a = 1;														// also OK because a is still type any
	var b = a + 2;										// error: mixed operand types: any and number`

	let {outputMessages} = Typl.Checker.check(code, {verbose:false});
	let errors = outputMessages.filter(m => m.type == "error")
	assert.equal(outputMessages.length, 16, 'total output length');
	assert.equal(errors.length, 1, 'num errors');
} );

QUnit.test( "Checker: #9 undef", function test(assert){
	assert.expect(2);
	let code  = `var a;
	var b = a + 1;										// error: mixed operand types
	
	a = 2;														// no error, overwrites a to type number
	b = a + 2;												// no error
	
	var c = undefined;
	c = 3;														// no error, overwrites c to type number
	
	var d = undef\`\`;
	d = 4;														// error, d is already tagged-type of undef`
	
	let {outputMessages} = Typl.Checker.check(code, {verbose:false});
	let errors = outputMessages.filter(m => m.type == "error")
	assert.equal(outputMessages.length, 24, 'total output length');
	assert.equal(errors.length, 2, 'num errors');
} );


QUnit.test( "Checker: #17 Narrower number type inference", function test(assert){
	assert.expect(2);
	let code  = `var x = 3;						// infer 'int'
	var y = 3.14;											// infer 'finite'
	var z = NaN;											// infer 'number'
	
	x = 2.2														// error, expected int, got number
	y = NaN														// error, expected finite, got number
	z = "a"														// error, expected number, found string`
	
	let {outputMessages} = Typl.Checker.check(code, {verbose:false});
	let errors = outputMessages.filter(m => m.type == "error")
	assert.equal(outputMessages.length, 29, 'total output length');
	assert.equal(errors.length, 3, 'num errors');
} );

QUnit.test( "Checker: #33 Treat IIFE as a validated call-expression", function test(assert){
	assert.expect(2);
	let code  = `var y = (function foo(x = number){
		return String(x);
	})(true);`
	
	let {outputMessages} = Typl.Checker.check(code, {verbose:false});
	let errors = outputMessages.filter(m => m.type == "error")
	assert.equal(outputMessages.length, 32, 'total output length');
	assert.equal(errors.length, 1, 'num errors');
} );

QUnit.test( "Checker: #34 check tagged-type simple literals", function test(assert){
	assert.expect(2);
	let code  = `int\`3.1\`							// should report an error
	finite\`3.1\`												// OK
	bool\`${true}\`											// OK
	bool\`true\`												// OK
	bool\`ok\`													// error`
	
	let {outputMessages} = Typl.Checker.check(code, {verbose:false});
	let errors = outputMessages.filter(m => m.type == "error")
	assert.equal(outputMessages.length, 34, 'total output length');
	assert.equal(errors.length, 2, 'num errors');
} );





function _isFunction(v) {
	return typeof v == "function";
}
