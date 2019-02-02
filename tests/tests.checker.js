"use strict";

QUnit.test( "Checker: API", function test(assert){
	assert.expect( 1 );

	assert.ok( _isFunction( Checker.check ), "check(..)" );
} );

QUnit.test( "Checker: check(..)", function test(assert){
	var rExpected = undefined;

	var rActual = Checker.check("var x;");

	assert.expect( 1 );
	assert.strictEqual( rActual, rExpected, "check(..)" );
} );





function _isFunction(v) {
	return typeof v == "function";
}
