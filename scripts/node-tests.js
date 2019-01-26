#!/usr/bin/env node

var path = require("path");

/* istanbul ignore next */
if (process.env.TEST_DIST) {
	let o = require(path.join("..","dist","typval.js"));
	Object.assign(global,o);
}
/* istanbul ignore next */
else if (process.env.TEST_PACKAGE) {
	let o = require(path.join(".."));
	Object.assign(global,o);
}
else {
	let o = require(path.join("..","src","typval.src.js"));
	Object.assign(global,o);
}

global.QUnit = require("qunit");

require("../tests/qunit.config.js");
require("../tests/tests.js");

QUnit.start();
