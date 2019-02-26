"use strict";
var path = require("path");
var Typl = require(path.join(__dirname, "..", "lib"));

// QUnit.test( "Checker: API", function test(assert){
// 	assert.expect( 1 );

// 	assert.ok( _isFunction( Checker.check ), "check(..)" );
// } );

// QUnit.test( "Checker: check(..)", function test(assert){
// 	var rExpected = undefined;

// 	var rActual = Checker.check("var x;");

// 	assert.expect( 1 );
// 	assert.strictEqual( rActual, rActual, "check(..)" );
// } );

QUnit.test("Checker: API", function test(assert) {
  assert.expect(1);
  assert.ok(_isFunction(Typl.Checker.check), "check(..)");
});


QUnit.test("Checker: any", function test(assert) {
  assert.expect(2);
  let code = `var a = any\`\`;
	a = "hello";  
	a = 1; 
	var b = a + 2;`
  
  let { outputMessages } = Typl.Checker.check(code);

  let errors = outputMessages.filter(m => m.type == "error")
  assert.equal(outputMessages.length, 4, 'total output length');
  assert.equal(errors.length, 1, 'num errors');
});


function _isFunction(v) {
  return typeof v == "function";
}