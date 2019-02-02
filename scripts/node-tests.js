#!/usr/bin/env node

"use strict";

var path = require("path");

/* istanbul ignore next */
if (process.env.TEST_DIST) {
	let runtime = require(path.join(__dirname,"..","dist","typval-runtime.js"));
	let Checker = require(path.join(__dirname,"..","lib","checker.js"));
	Object.assign(global,runtime,{ Checker, });
}
/* istanbul ignore next */
else if (process.env.TEST_PACKAGE) {
	let pkg = require(path.join(__dirname,".."));
	Object.assign(global,pkg);
}
else {
	let runtime = require(path.join(__dirname,"..","lib","runtime.js"));
	let Checker = require(path.join(__dirname,"..","lib","checker.js"));
	Object.assign(global,runtime,{ Checker, });
}

global.QUnit = require("qunit");

require(path.join("..","tests","qunit.config.js"));
require(path.join("..","tests","tests.runtime.js"));
require(path.join("..","tests","tests.checker.js"));

QUnit.start();
