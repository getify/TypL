#!/usr/bin/env node

"use strict";

var fs = require("fs"),
	path = require("path"),
	ugly = require("terser"),
	year = (new Date()).getFullYear(),

	ROOT_DIR = path.join(__dirname,".."),
	SRC_DIR = path.join(ROOT_DIR,"lib"),
	DIST_DIR = path.join(ROOT_DIR,"dist"),

	LIB_SRC = [
		path.join(SRC_DIR,"runtime.js"),
	],
	LIB_DIST = [
		path.join(DIST_DIR,"typl-runtime.js"),
	]
;


// ***************************

console.log("*** Building Typl ***");

// read version number from package.json
var packageJSON = JSON.parse(
	fs.readFileSync(
		path.join(ROOT_DIR,"package.json"),
		{ encoding: "utf8" }
	)
);
var version = packageJSON.version;

// read copyright-header text, render with version and year
var copyrightHeader = fs.readFileSync(
	path.join(SRC_DIR,"copyright-header.txt"),
	{ encoding: "utf8" }
).replace(/`/g,"");
copyrightHeader = Function("version","year",`return \`${copyrightHeader}\`;`)( version, year );


// ***************************

// try to make the dist directory, if needed
try {
	fs.mkdirSync(DIST_DIR,0o755);
}
catch (err) { }

for (let [idx,SRC] of LIB_SRC.entries()) {
	let DIST = LIB_DIST[idx];

	console.log(`Building: ${DIST}`);

	try {
		let result = "";

		result += fs.readFileSync(SRC,{ encoding: "utf8" });

		result = ugly.minify(result,{
			mangle: {
				keep_fnames: true
			},
			compress: {
				keep_fnames: true
			},
			output: {
				comments: /^!/
			}
		});

		// was compression successful?
		if (!(result && result.code)) {
			if (result.error) throw result.error;
			else throw result;
		}

		// append copyright-header text
		result = `${copyrightHeader}${result.code}`;

		// write dist
		fs.writeFileSync( DIST, result, { encoding: "utf8" } );
	}
	catch (err) {
		console.error(err);
		process.exit(1);
	}
}

console.log("Complete.");
