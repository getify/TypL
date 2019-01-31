#!/usr/bin/env node

"use strict";

var path = require("path");

/* istanbul ignore next */
if (process.env.TEST_DIST) {
	let runtime = require(path.join(__dirname,"..","dist","typval-runtime.js"));
	let Checker = require(path.join(__dirname,"..","dist","typval-checker.js"));
	Object.assign(global,runtime,{ Checker, });
}
/* istanbul ignore next */
else if (process.env.TEST_PACKAGE) {
	let pkg = require(path.join(__dirname,".."));
	Object.assign(global,pkg);
}
else {
	let runtime = require(path.join(__dirname,"..","src","runtime.js"));
	let Checker = require(path.join(__dirname,"..","src","checker.js"));
	Object.assign(global,runtime,{ Checker, });
}

global.QUnit = require("qunit");

require("../tests/qunit.config.js");
require("../tests/tests.js");

QUnit.start();
