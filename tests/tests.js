"use strict";

QUnit.test( "API", function test(assert){
	assert.expect( 13 );

	assert.ok( _isFunction( nul ), "nul(..)" );
	assert.ok( _isFunction( undef ), "undef(..)" );
	assert.ok( _isFunction( string ), "string(..)" );
	assert.ok( _isFunction( bool ), "bool(..)" );
	assert.ok( _isFunction( number ), "number(..)" );
	assert.ok( _isFunction( finite ), "finite(..)" );
	assert.ok( _isFunction( int ), "int(..)" );
	assert.ok( _isFunction( bigint ), "bigint(..)" );
	assert.ok( _isFunction( float ), "float(..)" );
	assert.ok( _isFunction( symb ), "symb(..)" );
	assert.ok( _isFunction( array ), "array(..)" );
	assert.ok( _isFunction( object ), "object(..)" );
	assert.ok( _isFunction( func ), "func(..)" );
} );

QUnit.test( "undef(..)", function test(assert){
	var rExpected = undefined;
	var pExpected = undefined;
	var qExpected = undefined;
	var tExpected = undefined;
	var sExpected = "invalid 1";
	var uExpected = "invalid 2";
	var vExpected = "invalid 3";
	var wExpected = "failed 1";
	var xExpected = "failed 2";

	var rActual = undef`undefined`;
	var pActual = undef`${undefined}`;
	var qActual = undef` \n undefined \t `;
	var tActual = undef` \n ${undefined} \t `;
	var sActual;
	try {
		sActual = undef` x ${undefined} y `;
	}
	catch (e) {
		sActual = (/invalid/i.test(e) ? "invalid 1" : e.toString());
	}
	var uActual;
	try {
		uActual = undef` x ${Object.create(null)} y `;
	}
	catch (e) {
		uActual = (/invalid/i.test(e) ? "invalid 2" : e.toString());
	}
	var vActual;
	try {
		vActual = undef`${undefined} ${undefined}`;
	}
	catch (e) {
		vActual = (/invalid/i.test(e) ? "invalid 3" : e.toString());
	}
	var wActual;
	try {
		wActual = undef`not undefined`;
	}
	catch (e) {
		wActual = (!/invalid/i.test(e) ? "failed 1" : e.toString());
	}
	var xActual;
	try {
		xActual = undef`${null}`;
	}
	catch (e) {
		xActual = (!/invalid/i.test(e) ? "failed 2" : e.toString());
	}

	assert.expect( 9 );
	assert.strictEqual( rActual, rExpected, "literal" );
	assert.strictEqual( pActual, pExpected, "value" );
	assert.strictEqual( qActual, qExpected, "extra whitespace: literal" );
	assert.strictEqual( tActual, tExpected, "extra whitespace: value" );
	assert.strictEqual( sActual, sExpected, "invalid: literals" );
	assert.strictEqual( uActual, uExpected, "invalid: non-string-coercible" );
	assert.strictEqual( vActual, vExpected, "invalid: multiple values" );
	assert.strictEqual( wActual, wExpected, "failed: literal" );
	assert.strictEqual( xActual, xExpected, "failed: value" );
} );




function _isFunction(v) {
	return typeof v == "function";
}
