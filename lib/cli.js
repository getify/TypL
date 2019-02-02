"use strict";

var path = require("path");
var fs = require("fs");

var TypVal = require(path.join(__dirname,".."));

var args = require("minimist")(process.argv.slice(2),{
	boolean: ["help",],
	string: ["file"]
});


if (args.help) {
	outputHelp();
}
else if (args.file) {
	let contents = fs.readFileSync(path.resolve(args.file),"utf-8");
	TypVal.Checker.check(contents);
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
	console.log("  typval --file={FILENAME}");
	console.log("");
	console.log("--help                                    show this help");
	console.log("--file={FILENAME}                         check file");
	console.log("");
}
