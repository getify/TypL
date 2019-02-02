"use strict";

var { default: traverse, } = require("@babel/traverse");
var { get, getDependencies, } = require("@babel/helpers");
var T = require("@babel/types");
var babylon = require("babylon");

var recognizedTypes = ["int","string"];
var discoveredNodeTypes = new WeakMap();

var visitors = {
	TaggedTemplateExpression(path) {
		var tagName = path.node.tag.name;
		if (recognizedTypes.includes(tagName)) {
			discoveredNodeTypes.set(path.node,{ taggedType: tagName });
		}
	},
	VariableDeclarator: {
		exit(path) {
			// does the declarator have an init expression?
			if (path.node.init) {
				let initType = discoveredNodeTypes.get(path.node.init);

				// did this init expression have a type?
				if (initType) {
					let declName = path.node.id.name;
					let binding = path.scope.getBinding(declName);
					// found a scope binding to attach the type to?
					if (binding && !discoveredNodeTypes.has(binding)) {
						discoveredNodeTypes.set(binding,initType);
					}

					console.log(`Assigning (initializer) type '${initType.taggedType}' to ${declName}`);
				}
			}
		},
	},
	AssignmentExpression: {
		exit(path,...rest) {
			var [leftType,rightType] = binaryExpressionTypes(path.node);
			if (leftType == "unknown") {
				let identifierType = getScopeBindingType(path.scope,path.node.left.name);
				if (identifierType) {
					leftType = identifierType;
				}
				else {
					let binding = path.scope.getBinding(path.node.left.name);
					if (binding) {
						discoveredNodeTypes.set(binding,{ taggedType: rightType, });
					}
				}
			}
			console.log(`Assigning type '${rightType}' to ${path.node.left.name} (which is currently type '${leftType}')`);
		},
	},
	BinaryExpression: {
		exit(path,...rest) {
			if (path.node.operator == "+") {
				return dispatchVisitor.call(this,visitorHelpers,"BinaryPlus",[path,...rest],"exit");
			}
		},
	},
	Identifier(path) {
		var identifierType = getScopeBindingType(path.scope,path.node.name);
		if (identifierType) {
			discoveredNodeTypes.set(path.node,identifierType);
		}
	}
};

var visitorHelpers = {
	BinaryPlus: {
		exit(path) {
			var [leftType,rightType] = binaryExpressionTypes(path.node);
			var exprType =
				leftType != "unknown" ? leftType :
				rightType != "unknown" ? rightType :
				"unknown";

			if (exprType != "unknown") {
				discoveredNodeTypes.set(path.node,{ taggedType: leftType });
			}
			console.log(`Binary Expression: type '${leftType}' + type '${rightType}'`);
		},
	},
};

Object.assign(module.exports,{
	check,
});


// ***********************************



function getScopeBindingType(scope,name) {
	var binding = scope.getBinding(name);
	if (binding && discoveredNodeTypes.has(binding)) {
		return discoveredNodeTypes.get(binding);
	}
}

function binaryExpressionTypes(node) {
	return [
		discoveredNodeTypes.has(node.left) ?
			discoveredNodeTypes.get(node.left).taggedType :
			"unknown",
		discoveredNodeTypes.has(node.right) ?
			discoveredNodeTypes.get(node.right).taggedType :
			"unknown"
	];
}

function dispatchVisitor(visitors,nodeName,args,visitType = "enter") {
	if (nodeName in visitors) {
		if (typeof visitors[nodeName] == "function") {
			if (visitType == "enter") {
				return visitors[nodeName].apply(this,args);
			}
		}
		else if (visitors[nodeName] && visitType in visitors[nodeName]) {
			return visitors[nodeName][visitType].apply(this,args);
		}
	}
}

function check(code) {
	var ast = babylon.parse(code);

	traverse(ast,visitors);

	return ast;
}
