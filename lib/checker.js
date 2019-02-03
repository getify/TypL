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
				handleAssignmentExpressionType(path.scope,path.node,path.node.id,path.node.init);
			}
		},
	},
	// default = value assignment (param, destructuring)
	AssignmentPattern: {
		exit(path,...rest) {
			handleAssignmentExpressionType(path.scope,path.node,path.node.left,path.node.right);
		}
	},
	AssignmentExpression: {
		exit(path) {
			handleAssignmentExpressionType(path.scope,path.node,path.node.left,path.node.right);
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
		// i.e., function foo(a = int) { .. }
		if (
			recognizedTypes.includes(path.node.name) &&
			T.isAssignmentPattern(path.parent)
		) {
			discoveredNodeTypes.set(path.node,{ taggedType: path.node.name, });
		}
		else {
			// pull identifier binding's tagged type (if any)
			let identifierType = getScopeBindingType(path.scope,path.node.name);
			if (identifierType) {
				discoveredNodeTypes.set(path.node,identifierType);
			}
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

function handleAssignmentExpressionType(scope,exprNode,targetNode,sourceNode) {
	// simple identifier assignment?
	if (T.isIdentifier(targetNode)) {
		let targetType = getScopeBindingType(scope,targetNode.name);
		let sourceType = discoveredNodeTypes.get(sourceNode);

		// source expression has a discovered type?
		if (sourceType) {
			discoveredNodeTypes.set(targetNode,sourceType);
			discoveredNodeTypes.set(exprNode,sourceType);

			// no target identifier type?
			if (!targetType) {
				setScopeBindingType(scope,targetNode.name,sourceType);
			}
			else if (!typesMatch(targetType,sourceType)) {
				// TODO: assignment type mismatch!
			}
		}
	}
	// array destructuring assignment?
	else if (T.isArrayPattern(targetNode)) {
		// TODO
	}
	else if (T.isObjectPattern(targetNode)) {
		// TODO
	}
}

function setScopeBindingType(scope,name,type) {
	var binding = scope.getBinding(name);
	// found a scope binding with no tagged type?
	if (
		binding &&
		!discoveredNodeTypes.has(binding)
	) {
		discoveredNodeTypes.set(binding,type);
		console.log(`Tagging ${name} with type '${type.taggedType}'`);
	}
}

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

function typesMatch(type1,type2) {
	return type1.taggedType == type2.taggedType;
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
