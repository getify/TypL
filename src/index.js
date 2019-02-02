"use strict";

var path = require("path");

var runtime = require(path.join(__dirname,"runtime.js"));
var Checker = require(path.join(__dirname,"checker.js"));

Object.assign(module.exports,runtime,{ Checker, });
