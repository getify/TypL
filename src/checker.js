"use strict";

var { default: traverse, } = require("@babel/traverse");
var { get, getDependencies, } = require("@babel/helpers");
var babylon = require("babylon");

Object.assign(module.exports,{
	check,
});


// ***********************************

function check(code) {
	var ast = babylon.parse(code);
	return ast;
}
