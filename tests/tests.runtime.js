"use strict";

QUnit.test( "Runtime: API", function test(assert){
	assert.expect( 14 );

	assert.ok( _isFunction( any ), "any(..)" );
	assert.ok( _isFunction( nul ), "nul(..)" );
	assert.ok( _isFunction( undef ), "undef(..)" );
	assert.ok( _isFunction( string ), "string(..)" );
	assert.ok( _isFunction( bool ), "bool(..)" );
	assert.ok( _isFunction( number ), "number(..)" );
	assert.ok( _isFunction( finite ), "finite(..)" );
	assert.ok( _isFunction( int ), "int(..)" );
	assert.ok( _isFunction( bint ), "bint(..)" );
	assert.ok( _isFunction( symb ), "symb(..)" );
	assert.ok( _isFunction( array ), "array(..)" );
	assert.ok( _isFunction( object ), "object(..)" );
	assert.ok( _isFunction( func ), "func(..)" );
	assert.ok( _isFunction( regex ), "regex(..)" );
} );

QUnit.test( "Runtime: any(..)", function test(assert){
	var rExpected = "hello world";
	var pExpected = 42;
	var qExpected = " hello 42 \ntrue! ";
	var tExpected = "";

	var rActual = any`hello world`;
	var pActual = any`${42}`;
	var qActual = any` hello ${42} \n${true}! `;
	var tActual = any``;

	assert.expect( 4 );
	assert.strictEqual( rActual, rExpected, "literal" );
	assert.strictEqual( pActual, pExpected, "value" );
	assert.strictEqual( qActual, qExpected, "multiple strings/values" );
	assert.strictEqual( tActual, tExpected, "empty string" );
} );

QUnit.test( "Runtime: undef(..)", function test(assert){
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
		wActual = (/is not type: undefined/i.test(e) ? "failed 1" : e.toString());
	}
	var xActual;
	try {
		xActual = undef`${null}`;
	}
	catch (e) {
		xActual = (/is not type: undefined/i.test(e) ? "failed 2" : e.toString());
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
	assert.strictEqual( xActual, xExpected, "failed: null value" );
} );

QUnit.test( "Runtime: nul(..)", function test(assert){
	var rExpected = null;
	var pExpected = null;
	var qExpected = null;
	var tExpected = null;
	var sExpected = "invalid 1";
	var uExpected = "invalid 2";
	var vExpected = "invalid 3";
	var wExpected = "failed 1";
	var xExpected = "failed 2";
	var yExpected = "failed 3";

	var rActual = nul`null`;
	var pActual = nul`${null}`;
	var qActual = nul` \n null \t `;
	var tActual = nul` \n ${null} \t `;
	var sActual;
	try {
		sActual = nul` x ${null} y `;
	}
	catch (e) {
		sActual = (/invalid/i.test(e) ? "invalid 1" : e.toString());
	}
	var uActual;
	try {
		uActual = nul` x ${Object.create(null)} y `;
	}
	catch (e) {
		uActual = (/invalid/i.test(e) ? "invalid 2" : e.toString());
	}
	var vActual;
	try {
		vActual = nul`${null} ${null}`;
	}
	catch (e) {
		vActual = (/invalid/i.test(e) ? "invalid 3" : e.toString());
	}
	var wActual;
	try {
		wActual = nul`not null`;
	}
	catch (e) {
		wActual = (/is not type: null/i.test(e) ? "failed 1" : e.toString());
	}
	var xActual;
	try {
		xActual = nul`${undefined}`;
	}
	catch (e) {
		xActual = (/is not type: null/i.test(e) ? "failed 2" : e.toString());
	}
	var yActual;
	try {
		yActual = nul`${Object.create(null)}`;
	}
	catch (e) {
		yActual = (/is not type: null/i.test(e) ? "failed 3" : e.toString());
	}

	assert.expect( 10 );
	assert.strictEqual( rActual, rExpected, "literal" );
	assert.strictEqual( pActual, pExpected, "value" );
	assert.strictEqual( qActual, qExpected, "extra whitespace: literal" );
	assert.strictEqual( tActual, tExpected, "extra whitespace: value" );
	assert.strictEqual( sActual, sExpected, "invalid: literals" );
	assert.strictEqual( uActual, uExpected, "invalid: non-string-coercible" );
	assert.strictEqual( vActual, vExpected, "invalid: multiple values" );
	assert.strictEqual( wActual, wExpected, "failed: literal" );
	assert.strictEqual( xActual, xExpected, "failed: undefined value" );
	assert.strictEqual( yActual, yExpected, "failed: non-string-coercible" );
} );

QUnit.test( "Runtime: string(..)", function test(assert){
	var rExpected = "hello";
	var pExpected = "hello";
	var qExpected = " \n hello \t ";
	var tExpected = " \n hello \t ";
	var sExpected = "";
	var uExpected = "failed 1";
	var vExpected = "failed 2";
	var wExpected = "failed 3";

	var rActual = string`hello`;
	var pActual = string`${"hello"}`;
	var qActual = string` \n hello \t `;
	var tActual = string` \n ${"hello"} \t `;
	var sActual = string``;
	var uActual;
	try {
		uActual = string`${42}`;
	}
	catch (e) {
		uActual = (/is not type: string/i.test(e) ? "failed 1" : e.toString());
	}
	var vActual;
	try {
		vActual = string`x ${42} y`;
	}
	catch (e) {
		vActual = (/is not type: string/i.test(e) ? "failed 2" : e.toString());
	}
	var wActual;
	try {
		wActual = string`${"foo"} ${"bar"} ${42}`;
	}
	catch (e) {
		wActual = (/is not type: string/i.test(e) ? "failed 3" : e.toString());
	}

	assert.expect( 8 );
	assert.strictEqual( rActual, rExpected, "literal" );
	assert.strictEqual( pActual, pExpected, "value" );
	assert.strictEqual( qActual, qExpected, "extra whitespace: literal" );
	assert.strictEqual( tActual, tExpected, "extra whitespace: value" );
	assert.strictEqual( sActual, sExpected, "empty string" );
	assert.strictEqual( uActual, uExpected, "failed: number value" );
	assert.strictEqual( vActual, vExpected, "failed: literals + number" );
	assert.strictEqual( wActual, wExpected, "failed: multiple values" );
} );

QUnit.test( "Runtime: bool(..)", function test(assert){
	var rExpected = false;
	var pExpected = false;
	var qExpected = true;
	var tExpected = true;
	var sExpected = "invalid 1";
	var uExpected = "invalid 2";
	var vExpected = "invalid 3";
	var wExpected = "failed 1";
	var xExpected = "failed 2";

	var rActual = bool`false`;
	var pActual = bool`${false}`;
	var qActual = bool` \n true \t `;
	var tActual = bool` \n ${true} \t `;
	var sActual;
	try {
		sActual = bool` x ${true} y `;
	}
	catch (e) {
		sActual = (/invalid/i.test(e) ? "invalid 1" : e.toString());
	}
	var uActual;
	try {
		uActual = bool` x ${Object.create(null)} y `;
	}
	catch (e) {
		uActual = (/invalid/i.test(e) ? "invalid 2" : e.toString());
	}
	var vActual;
	try {
		vActual = bool`${false} ${true}`;
	}
	catch (e) {
		vActual = (/invalid/i.test(e) ? "invalid 3" : e.toString());
	}
	var wActual;
	try {
		wActual = bool`not false`;
	}
	catch (e) {
		wActual = (/is not type: boolean/i.test(e) ? "failed 1" : e.toString());
	}
	var xActual;
	try {
		xActual = bool`${1}`;
	}
	catch (e) {
		xActual = (/is not type: boolean/i.test(e) ? "failed 2" : e.toString());
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
	assert.strictEqual( xActual, xExpected, "failed: number value" );
} );

QUnit.test( "Runtime: number(..)", function test(assert){
	var rExpected = 42;
	var pExpected = 42;
	var qExpected = NaN;
	var tExpected = NaN;
	var sExpected = "invalid 1";
	var uExpected = "invalid 2";
	var vExpected = "invalid 3";
	var wExpected = "failed 1";
	var xExpected = "failed 2";
	var yExpected = "failed 3";

	var rActual = number`42`;
	var pActual = number`${42}`;
	var qActual = number` \n NaN \t `;
	var tActual = number` \n ${NaN} \t `;
	var sActual;
	try {
		sActual = number` x ${42} y `;
	}
	catch (e) {
		sActual = (/invalid/i.test(e) ? "invalid 1" : e.toString());
	}
	var uActual;
	try {
		uActual = number` x ${Object.create(null)} y `;
	}
	catch (e) {
		uActual = (/invalid/i.test(e) ? "invalid 2" : e.toString());
	}
	var vActual;
	try {
		vActual = number`${42} ${42}`;
	}
	catch (e) {
		vActual = (/invalid/i.test(e) ? "invalid 3" : e.toString());
	}
	var wActual;
	try {
		wActual = number`forty-two`;
	}
	catch (e) {
		wActual = (/is not type: number/i.test(e) ? "failed 1" : e.toString());
	}
	var xActual;
	try {
		xActual = number``;
	}
	catch (e) {
		xActual = (/is not type: number/i.test(e) ? "failed 2" : e.toString());
	}
	var yActual;
	try {
		yActual = number`${"hello"}`;
	}
	catch (e) {
		yActual = (/is not type: number/i.test(e) ? "failed 3" : e.toString());
	}

	assert.expect( 10 );
	assert.strictEqual( rActual, rExpected, "literal" );
	assert.strictEqual( pActual, pExpected, "value" );
	assert.ok( Object.is( qActual, qExpected ), "extra whitespace: literal (NaN)" );
	assert.ok( Object.is( tActual, tExpected ), "extra whitespace: value (NaN)" );
	assert.strictEqual( sActual, sExpected, "invalid: literals" );
	assert.strictEqual( uActual, uExpected, "invalid: non-string-coercible" );
	assert.strictEqual( vActual, vExpected, "invalid: multiple values" );
	assert.strictEqual( wActual, wExpected, "failed: literal" );
	assert.strictEqual( xActual, xExpected, "failed: empty literal (not zero)" );
	assert.strictEqual( yActual, yExpected, "failed: string value" );
} );

QUnit.test( "Runtime: finite(..)", function test(assert){
	var rExpected = 1E308;
	var pExpected = 1E308;
	var qExpected = 42;
	var tExpected = 42;
	var sExpected = "invalid 1";
	var uExpected = "invalid 2";
	var vExpected = "invalid 3";
	var wExpected = "failed 1";
	var xExpected = "failed 2";
	var yExpected = "failed 3";
	var zExpected = "failed 4";

	var rActual = finite`1E308`;
	var pActual = finite`${1E308}`;
	var qActual = finite` \n 42 \t `;
	var tActual = finite` \n ${42} \t `;
	var sActual;
	try {
		sActual = finite` x ${42} y `;
	}
	catch (e) {
		sActual = (/invalid/i.test(e) ? "invalid 1" : e.toString());
	}
	var uActual;
	try {
		uActual = finite` x ${Object.create(null)} y `;
	}
	catch (e) {
		uActual = (/invalid/i.test(e) ? "invalid 2" : e.toString());
	}
	var vActual;
	try {
		vActual = finite`${42} ${42}`;
	}
	catch (e) {
		vActual = (/invalid/i.test(e) ? "invalid 3" : e.toString());
	}
	var wActual;
	try {
		wActual = finite`infinitely`;
	}
	catch (e) {
		wActual = (/is not type: finite/i.test(e) ? "failed 1" : e.toString());
	}
	var xActual;
	try {
		xActual = finite``;
	}
	catch (e) {
		xActual = (/is not type: finite/i.test(e) ? "failed 2" : e.toString());
	}
	var yActual;
	try {
		yActual = finite`${Infinity}`;
	}
	catch (e) {
		yActual = (/is not type: finite/i.test(e) ? "failed 3" : e.toString());
	}
	var zActual;
	try {
		zActual = finite`${"hello"}`;
	}
	catch (e) {
		zActual = (/is not type: finite/i.test(e) ? "failed 4" : e.toString());
	}

	assert.expect( 11 );
	assert.strictEqual( rActual, rExpected, "literal" );
	assert.strictEqual( pActual, pExpected, "value" );
	assert.strictEqual( qActual, qExpected, "extra whitespace: literal" );
	assert.strictEqual( tActual, tExpected, "extra whitespace: value" );
	assert.strictEqual( sActual, sExpected, "invalid: literals" );
	assert.strictEqual( uActual, uExpected, "invalid: non-string-coercible" );
	assert.strictEqual( vActual, vExpected, "invalid: multiple values" );
	assert.strictEqual( wActual, wExpected, "failed: literal" );
	assert.strictEqual( xActual, xExpected, "failed: empty literal (not zero)" );
	assert.strictEqual( yActual, yExpected, "failed: Infinity" );
	assert.strictEqual( zActual, zExpected, "failed: string value" );
} );

QUnit.test( "Runtime: int(..)", function test(assert){
	var rExpected = 42;
	var pExpected = 42;
	var qExpected = 42;
	var tExpected = 42;
	var sExpected = "invalid 1";
	var uExpected = "invalid 2";
	var vExpected = "invalid 3";
	var wExpected = "failed 1";
	var xExpected = "failed 2";
	var yExpected = "failed 3";
	var zExpected = "failed 4";

	var rActual = int`42`;
	var pActual = int`${42}`;
	var qActual = int` \n 42 \t `;
	var tActual = int` \n ${42} \t `;
	var sActual;
	try {
		sActual = int` x ${42} y `;
	}
	catch (e) {
		sActual = (/invalid/i.test(e) ? "invalid 1" : e.toString());
	}
	var uActual;
	try {
		uActual = int` x ${Object.create(null)} y `;
	}
	catch (e) {
		uActual = (/invalid/i.test(e) ? "invalid 2" : e.toString());
	}
	var vActual;
	try {
		vActual = int`${42} ${42}`;
	}
	catch (e) {
		vActual = (/invalid/i.test(e) ? "invalid 3" : e.toString());
	}
	var wActual;
	try {
		wActual = int`PI`;
	}
	catch (e) {
		wActual = (/is not type: int/i.test(e) ? "failed 1" : e.toString());
	}
	var xActual;
	try {
		xActual = int``;
	}
	catch (e) {
		xActual = (/is not type: int/i.test(e) ? "failed 2" : e.toString());
	}
	var yActual;
	try {
		yActual = int`${3.14}`;
	}
	catch (e) {
		yActual = (/is not type: int/i.test(e) ? "failed 3" : e.toString());
	}
	var zActual;
	try {
		zActual = int`${"hello"}`;
	}
	catch (e) {
		zActual = (/is not type: int/i.test(e) ? "failed 4" : e.toString());
	}

	assert.expect( 11 );
	assert.strictEqual( rActual, rExpected, "literal" );
	assert.strictEqual( pActual, pExpected, "value" );
	assert.strictEqual( qActual, qExpected, "extra whitespace: literal" );
	assert.strictEqual( tActual, tExpected, "extra whitespace: value" );
	assert.strictEqual( sActual, sExpected, "invalid: literals" );
	assert.strictEqual( uActual, uExpected, "invalid: non-string-coercible" );
	assert.strictEqual( vActual, vExpected, "invalid: multiple values" );
	assert.strictEqual( wActual, wExpected, "failed: literal" );
	assert.strictEqual( xActual, xExpected, "failed: empty literal (not zero)" );
	assert.strictEqual( yActual, yExpected, "failed: floating point" );
	assert.strictEqual( zActual, zExpected, "failed: string value" );
} );

QUnit.test( "Runtime: bint(..)", function test(assert){
	if (typeof BigInt == "undefined") {
		assert.expect(0);
		return;
	}

	var rExpected = 42n;
	var pExpected = 42n;
	var qExpected = 42n;
	var tExpected = 42n;
	var sExpected = "invalid 1";
	var uExpected = "invalid 2";
	var vExpected = "invalid 3";
	var wExpected = "failed 1";
	var xExpected = "failed 2";
	var yExpected = "failed 3";
	var zExpected = "failed 4";

	var rActual = bint`42n`;
	var pActual = bint`${42n}`;
	var qActual = bint` \n 42n \t `;
	var tActual = bint` \n ${42n} \t `;
	var sActual;
	try {
		sActual = bint` x ${42n} y `;
	}
	catch (e) {
		sActual = (/invalid/i.test(e) ? "invalid 1" : e.toString());
	}
	var uActual;
	try {
		uActual = bint` x ${Object.create(null)} y `;
	}
	catch (e) {
		uActual = (/invalid/i.test(e) ? "invalid 2" : e.toString());
	}
	var vActual;
	try {
		vActual = bint`${42n} ${42n}`;
	}
	catch (e) {
		vActual = (/invalid/i.test(e) ? "invalid 3" : e.toString());
	}
	var wActual;
	try {
		wActual = bint`42big`;
	}
	catch (e) {
		wActual = (/is not type: bigint/i.test(e) ? "failed 1" : e.toString());
	}
	var xActual;
	try {
		xActual = bint``;
	}
	catch (e) {
		xActual = (/is not type: bigint/i.test(e) ? "failed 2" : e.toString());
	}
	var yActual;
	try {
		yActual = bint`${42}`;
	}
	catch (e) {
		yActual = (/is not type: bigint/i.test(e) ? "failed 3" : e.toString());
	}
	var zActual;
	try {
		zActual = bint`${"hello"}`;
	}
	catch (e) {
		zActual = (/is not type: bigint/i.test(e) ? "failed 4" : e.toString());
	}

	assert.expect( 11 );
	assert.strictEqual( rActual, rExpected, "literal" );
	assert.strictEqual( pActual, pExpected, "value" );
	assert.strictEqual( qActual, qExpected, "extra whitespace: literal" );
	assert.strictEqual( tActual, tExpected, "extra whitespace: value" );
	assert.strictEqual( sActual, sExpected, "invalid: literals" );
	assert.strictEqual( uActual, uExpected, "invalid: non-string-coercible" );
	assert.strictEqual( vActual, vExpected, "invalid: multiple values" );
	assert.strictEqual( wActual, wExpected, "failed: literal" );
	assert.strictEqual( xActual, xExpected, "failed: empty literal (not zero)" );
	assert.strictEqual( yActual, yExpected, "failed: floating point" );
	assert.strictEqual( zActual, zExpected, "failed: string value" );
} );

QUnit.test( "Runtime: symb(..)", function test(assert){
	var rExpected = "Symbol(abc)";
	var pExpected = "Symbol(abc)";
	var qExpected = "Symbol(abc)";
	var tExpected = "Symbol(abc)";
	var sExpected = "invalid 1";
	var uExpected = "invalid 2";
	var vExpected = "invalid 3";
	var wExpected = "failed 1";
	var xExpected = "failed 2";

	var rActual = String( symb`Symbol('abc')` );
	var pActual = String( symb`${Symbol('abc')}` );
	var qActual = String( symb` \n Symbol('abc') \t ` );
	var tActual = String( symb` \n ${Symbol('abc')} \t ` );
	var sActual;
	try {
		sActual = symb` x ${Symbol('abc')} y `;
	}
	catch (e) {
		sActual = (/invalid/i.test(e) ? "invalid 1" : e.toString());
	}
	var uActual;
	try {
		uActual = symb` x ${Object.create(null)} y `;
	}
	catch (e) {
		uActual = (/invalid/i.test(e) ? "invalid 2" : e.toString());
	}
	var vActual;
	try {
		vActual = symb`${"abc"} ${"abc"}`;
	}
	catch (e) {
		vActual = (/invalid/i.test(e) ? "invalid 3" : e.toString());
	}
	var wActual;
	try {
		wActual = symb`symbol-abc`;
	}
	catch (e) {
		wActual = (/is not type: symbol/i.test(e) ? "failed 1" : e.toString());
	}
	var xActual;
	try {
		xActual = symb`${1}`;
	}
	catch (e) {
		xActual = (/is not type: symbol/i.test(e) ? "failed 2" : e.toString());
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
	assert.strictEqual( xActual, xExpected, "failed: number value" );
} );

QUnit.test( "Runtime: array(..)", function test(assert){
	var rExpected = [1,2,3];
	var pExpected = [1,2,3];
	var qExpected = [1,2,3];
	var tExpected = [1,2,3];
	var sExpected = "invalid 1";
	var uExpected = "invalid 2";
	var vExpected = "invalid 3";
	var wExpected = "failed 1";
	var xExpected = "failed 2";

	var rActual = array`[1,2,3]`;
	var pActual = array`${[1,2,3]}`;
	var qActual = array` \n [1,2,3] \t `;
	var tActual = array` \n ${[1,2,3]} \t `;
	var sActual;
	try {
		sActual = array` x ${[1,2,3]} y `;
	}
	catch (e) {
		sActual = (/invalid/i.test(e) ? "invalid 1" : e.toString());
	}
	var uActual;
	try {
		uActual = array` x ${Object.create(null)} y `;
	}
	catch (e) {
		uActual = (/invalid/i.test(e) ? "invalid 2" : e.toString());
	}
	var vActual;
	try {
		vActual = array`${[1,2,3]} ${[1,2,3]}`;
	}
	catch (e) {
		vActual = (/invalid/i.test(e) ? "invalid 3" : e.toString());
	}
	var wActual;
	try {
		wActual = array`arrs`;
	}
	catch (e) {
		wActual = (/is not type: array/i.test(e) ? "failed 1" : e.toString());
	}
	var xActual;
	try {
		xActual = array`${1}`;
	}
	catch (e) {
		xActual = (/is not type: array/i.test(e) ? "failed 2" : e.toString());
	}

	assert.expect( 9 );
	assert.deepEqual( rActual, rExpected, "literal" );
	assert.deepEqual( pActual, pExpected, "value" );
	assert.deepEqual( qActual, qExpected, "extra whitespace: literal" );
	assert.deepEqual( tActual, tExpected, "extra whitespace: value" );
	assert.strictEqual( sActual, sExpected, "invalid: literals" );
	assert.strictEqual( uActual, uExpected, "invalid: non-string-coercible" );
	assert.strictEqual( vActual, vExpected, "invalid: multiple values" );
	assert.strictEqual( wActual, wExpected, "failed: literal" );
	assert.strictEqual( xActual, xExpected, "failed: number value" );
} );

QUnit.test( "Runtime: object(..)", function test(assert){
	var rExpected = {a:1,b:2,c:3,};
	var pExpected = {a:1,b:2,c:3,};
	var qExpected = {a:1,b:2,c:3,};
	var tExpected = {a:1,b:2,c:3,};
	var sExpected = "invalid 1";
	var uExpected = "invalid 2";
	var vExpected = "invalid 3";
	var wExpected = "failed 1";
	var xExpected = "failed 2";

	var rActual = object`{a:1,b:2,c:3,}`;
	var pActual = object`${{a:1,b:2,c:3,}}`;
	var qActual = object` \n {a:1,b:2,c:3,} \t `;
	var tActual = object` \n ${{a:1,b:2,c:3,}} \t `;
	var sActual;
	try {
		sActual = object` x ${{a:1,b:2,c:3,}} y `;
	}
	catch (e) {
		sActual = (/invalid/i.test(e) ? "invalid 1" : e.toString());
	}
	var uActual;
	try {
		uActual = object` x ${Object.create(null)} y `;
	}
	catch (e) {
		uActual = (/invalid/i.test(e) ? "invalid 2" : e.toString());
	}
	var vActual;
	try {
		vActual = object`${{}} ${{}}`;
	}
	catch (e) {
		vActual = (/invalid/i.test(e) ? "invalid 3" : e.toString());
	}
	var wActual;
	try {
		wActual = object`objs`;
	}
	catch (e) {
		wActual = (/is not type: object/i.test(e) ? "failed 1" : e.toString());
	}
	var xActual;
	try {
		xActual = object`${1}`;
	}
	catch (e) {
		xActual = (/is not type: object/i.test(e) ? "failed 2" : e.toString());
	}

	assert.expect( 9 );
	assert.deepEqual( rActual, rExpected, "literal" );
	assert.deepEqual( pActual, pExpected, "value" );
	assert.deepEqual( qActual, qExpected, "extra whitespace: literal" );
	assert.deepEqual( tActual, tExpected, "extra whitespace: value" );
	assert.strictEqual( sActual, sExpected, "invalid: literals" );
	assert.strictEqual( uActual, uExpected, "invalid: non-string-coercible" );
	assert.strictEqual( vActual, vExpected, "invalid: multiple values" );
	assert.strictEqual( wActual, wExpected, "failed: literal" );
	assert.strictEqual( xActual, xExpected, "failed: number value" );
} );

QUnit.test( "Runtime: func(..)", function test(assert){
	function foo() { var x = 1; }

	var rExpected = foo.toString();
	var pExpected = foo.toString();
	var qExpected = foo.toString();
	var tExpected = foo.toString();
	var sExpected = "invalid 1";
	var uExpected = "invalid 2";
	var vExpected = "invalid 3";
	var wExpected = "failed 1";
	var xExpected = "failed 2";

	var rActual = String( func`function foo() { var x = 1; }` );
	var pActual = String( func`${foo}` );
	var qActual = String( func` \n function foo() { var x = 1; } \t ` );
	var tActual = String( func` \n ${foo} \t ` );
	var sActual;
	try {
		sActual = func` x ${foo} y `;
	}
	catch (e) {
		sActual = (/invalid/i.test(e) ? "invalid 1" : e.toString());
	}
	var uActual;
	try {
		uActual = func` x ${Object.create(null)} y `;
	}
	catch (e) {
		uActual = (/invalid/i.test(e) ? "invalid 2" : e.toString());
	}
	var vActual;
	try {
		vActual = func`${foo} ${foo}`;
	}
	catch (e) {
		vActual = (/invalid/i.test(e) ? "invalid 3" : e.toString());
	}
	var wActual;
	try {
		wActual = func`funfunfun`;
	}
	catch (e) {
		wActual = (/is not type: function/i.test(e) ? "failed 1" : e.toString());
	}
	var xActual;
	try {
		xActual = func`${1}`;
	}
	catch (e) {
		xActual = (/is not type: function/i.test(e) ? "failed 2" : e.toString());
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
	assert.strictEqual( xActual, xExpected, "failed: number value" );
} );

QUnit.test( "Runtime: regex(..)", function test(assert){
	var rExpected = "/foo+bar?/gs";
	var pExpected = "/foo+bar?/gs";
	var qExpected = "/foo+bar?/gs";
	var tExpected = "/foo+bar?/gs";
	var sExpected = "/foo+42bar?10/gs";
	var uExpected = "failed 1";
	var vExpected = "failed 2";
	var wExpected = "failed 3";

	var rActual = String( regex`/foo+bar?/gs` );
	var pActual = String( regex`${/foo+bar?/gs}` );
	var qActual = String( regex` \n /foo+bar?/gs \t ` );
	var tActual = String( regex` \n ${/foo+bar?/gs} \t ` );
	var sActual = String( regex`/foo+${42}bar?${10}/gs` );
	var uActual;
	try {
		uActual = regex`${42}`;
	}
	catch (e) {
		uActual = (/is not type: regular expression/i.test(e) ? "failed 1" : e.toString());
	}
	var vActual;
	try {
		vActual = regex`x ${/foo/} y`;
	}
	catch (e) {
		vActual = (/is not type: regular expression/i.test(e) ? "failed 2" : e.toString());
	}
	var wActual;
	try {
		wActual = regex`${/foo/} ${/bar/} ${42}`;
	}
	catch (e) {
		wActual = (/is not type: regular expression/i.test(e) ? "failed 3" : e.toString());
	}

	assert.expect( 8 );
	assert.strictEqual( rActual, rExpected, "literal" );
	assert.strictEqual( pActual, pExpected, "value" );
	assert.strictEqual( qActual, qExpected, "extra whitespace: literal" );
	assert.strictEqual( tActual, tExpected, "extra whitespace: value" );
	assert.strictEqual( sActual, sExpected, "multiple values" );
	assert.strictEqual( uActual, uExpected, "failed: number value" );
	assert.strictEqual( vActual, vExpected, "failed: literals + regex" );
	assert.strictEqual( wActual, wExpected, "failed: multiple values" );
} );





function _isFunction(v) {
	return typeof v == "function";
}
