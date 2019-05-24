"use strict";

var path = require("path");
var TL = require(path.join(__dirname, "..", "lib"));

QUnit.test("Checker: #39 array-of-type annotation", function test(assert) {
	assert.expect(1);
	let code = `
		var x = array\`int[]\`;
		var y = array\`int[]\`\`[1,2,3]\`;
		var z = array\`int[]\`\`\${y}\`;
		
		x = [1,2,3];	// OK!
		y = [4,5,6];	// OK!
		z = x;				// OK!
		z = ["a","b","c"]		// error
	`;
	let { outputMessages, } = TL.Checker.check(code, { verbose: false, });
	let errors = outputMessages.filter(function isError(msg) { return msg.type == "error"; });
	// assert.equal(outputMessages.length, 8, "total output length");
	assert.equal(errors.length, 1, "num errors");
});

QUnit.test("Checker: #39 Non-empty arrays ", function test(assert) {
	assert.expect(1);
	let code = `
		var x = array\`int[]\`\`\${ [] }\`;		// OK, allowed to be empty
		var y = array\`int[+]\`\`\${ [] }\`;		// error, not allowed to be empty
		y = [] // error
	`;
	let { outputMessages, } = TL.Checker.check(code, { verbose: false, });
	let errors = outputMessages.filter(function isError(msg) { return msg.type == "error"; });
	// assert.equal(outputMessages.length, 15, "total output length");
	assert.equal(errors.length, 2, "num errors");
});

QUnit.test("Checker: #39 Non-empty arrays", function test(assert) {
	assert.expect(1);
	let code = `
		var x = array\`int[]\`\`\${ [] }\`;		// OK, allowed to be empty
		var y = array\`int[+]\`\`\${ [] }\`;		// error, not allowed to be empty
		y = [] // error
	`;
	let { outputMessages, } = TL.Checker.check(code, { verbose: false, });
	let errors = outputMessages.filter(function isError(msg) { return msg.type == "error"; });
	// assert.equal(outputMessages.length, 21, "total output length");
	assert.equal(errors.length, 2, "num errors");
});

QUnit.test("Checker: #39 Array of various types (union types)", function test(assert) {
	assert.expect(1);
	let code = `
		var x = array\`(int | string)[]\`;
		x = [ 1, 2, "hello", 4 ];		// OK!
		x = [ 1, 2, true, 4 ];			// error
	`;
	let { outputMessages, } = TL.Checker.check(code, { verbose: false, });
	let errors = outputMessages.filter(function isError(msg) { return msg.type == "error"; });
	// assert.equal(outputMessages.length, 25, "total output length");
	assert.equal(errors.length, 1, "num errors");
});

QUnit.test("Checker: #39 multidimensional arrays", function test(assert) {
	assert.expect(1);
	let code = `
		var x = array\`int[][]\`;
		var y = array\`int[][][]\`;
		var z = array\`(int | string)[][]\`;
		
		x = [
			[1,2,3],
			[4],
			[5,6],
			[7,8,9,10]
		];   // OK!
		
		y = [
			[
				[1,2,3],
				[4,5,6],
				[7,8,9]
			],
			[
				[1,0,0],
				[0,1,0],
				[0,0,1]
			]
		];   // OK!
		
		z = [
			[1,"hello"],
			[2,3,"world"],
			["ok"],
			[42]
		];   // OK!
	`;
	let { outputMessages, } = TL.Checker.check(code, { verbose: false, });
	let errors = outputMessages.filter(function isError(msg) { return msg.type == "error"; });
	// assert.equal(outputMessages.length,47,"total output length");
	assert.equal(errors.length, 0, "num errors");
});

QUnit.test("Checker: #39 Tuple, Nested Tuple", function test(assert) {
	assert.expect(1);
	let code = `
		var x = array\`<int,string>\`;
		var y = array\`<<int,string>,bool>\`;
		
		x = [ 42, "hello world" ];   // OK!
		y = [ x, true ];   // OK!
	`;
	let { outputMessages, } = TL.Checker.check(code, { verbose: false, });
	let errors = outputMessages.filter(function isError(msg) { return msg.type == "error"; });
	// assert.equal(outputMessages.length,25,"total output length");
	assert.equal(errors.length, 1, "num errors");
});

QUnit.test("Checker: #39 Array of tuples", function test(assert) {
	assert.expect(1);
	let code = `
		var x = array\`<int,string>[]\`;
		x = [
			[42,"hello"],
			[10,"world"]
		]; 
	`;
	let { outputMessages, } = TL.Checker.check(code, { verbose: false, });
	let errors = outputMessages.filter(function isError(msg) { return msg.type == "error"; });
	// assert.equal(outputMessages.length,25,"total output length");
	assert.equal(errors.length, 0, "num errors");
});


QUnit.test("Checker: #39 Tuple of arrays", function test(assert) {
	assert.expect(1);
	let code = `
		var x = array\`<int,string>[]\`;
		x = [
			[42,"hello"],
			[10,"world"]
		]; 
	`;
	let { outputMessages, } = TL.Checker.check(code, { verbose: false, });
	let errors = outputMessages.filter(function isError(msg) { return msg.type == "error"; });
	// assert.equal(outputMessages.length,25,"total output length");
	assert.equal(errors.length, 0, "num errors");
});

QUnit.test("Checker: #39 Array of tuples of arrays", function test(assert) {
	assert.expect(1);
	let code = `
		var x = array\`<int[],string[]>[]\`;
		x = [
			[
				[1,2,3,4],
				["hello","world"]
			],
			[
				[5,6],
				[]
			],
			[
				[7],
				["very","cool","stuff"]
			]
		];   // OK!
	`;
	let { outputMessages, } = TL.Checker.check(code, { verbose: false, });
	let errors = outputMessages.filter(function isError(msg) { return msg.type == "error"; });
	// assert.equal(outputMessages.length,25,"total output length");
	assert.equal(errors.length, 0, "num errors");
});