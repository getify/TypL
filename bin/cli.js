#!/usr/bin/env node

"use strict";

var path = require("path");
var fs = require("fs");

var Checker = require(path.join(__dirname,"..","src","checker.js"));

var args = require("minimist")(process.argv.slice(2),{
	boolean: ["help",],
});


if (args.help) {
	showHelp();
}
else {
	reportError("Incorrect usage.",/*showHelp=*/true);
}


// ***********************************

function reportError(err,showHelp = false) {
	if (err) {
		console.error(err.toString());
	}
	if (showHelp) {
		console.log("");
		outputHelp();
	}
	process.exitCode = 1;
}

function outputHelp() {
	console.log("TypVal Usage:");
	console.log("  typval {OPTIONS}");
	console.log("");
	console.log("--help                                    show this help");
	console.log("");
}
