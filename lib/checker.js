"use strict";

var { default: traverse, } = require("@babel/traverse");
var T = require("@babel/types");
var babylon = require("babylon");

var recognizedTypes = [
	"any", "undef", "nul", "string", "bool",
	"number", "finite", "int", "bint", "symb",
	"array", "object", "func", "regex",
];

var discoveredNodeTypes = new WeakMap();

var visitors = {
	TaggedTemplateExpression(path) {
		var tagName = path.node.tag.name;
		if (recognizedTypes.includes(tagName)) {
			discoveredNodeTypes.set(path.node,{ tagged: tagName, });
		}
	},
	TemplateLiteral(path) {
		if (T.isTaggedTemplateExpression(path.parent)) {
			let parentType = discoveredNodeTypes.get(path.parent.node);
			if (parentType) {
				discoveredNodeTypes.set(path.node,{ ...parentType, });
			}
			else {
				discoveredNodeTypes.set(path.node,{ inferred: "unknown", });
			}
		}
		else {
			discoveredNodeTypes.set(path.node,{ inferred: "string", });
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
		exit(path) {
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
	FunctionDeclaration: {
		enter(path) {
			discoveredNodeTypes.set(path.node,{
				inferred: "func",
				returnType: {
					default: true,
					inferred: "undef",
				},
				paramTypes: [],
			});
		},
		exit(path) {
			var funcSignatureType = discoveredNodeTypes.get(path.node);

			for (let param of path.node.params) {
				let paramType = discoveredNodeTypes.get(param);
				if (paramType) {
					funcSignatureType.paramTypes.push(paramType);
				}
				else {
					funcSignatureType.paramTypes.push({ inferred: "unknown", });
				}
			}

			console.log(discoveredNodeTypes.get(path.node));
		}
	},
	ReturnStatement: {
		exit(path) {
			var func = path.getFunctionParent().node;
			var funcSignatureType = discoveredNodeTypes.get(func);

			if (funcSignatureType) {
				let returnType = (path.node.argument) ?
					discoveredNodeTypes.get(path.node.argument) :
					{ inferred: "undef", };

				// first encountered `return` of the function?
				if (funcSignatureType.returnType.default === true) {
					delete funcSignatureType.returnType.default;
					if (returnType) {
						delete funcSignatureType.returnType.inferred;
						Object.assign(funcSignatureType.returnType,returnType);
					}
				}
				else if (
					returnType &&
					!typesMatch(funcSignatureType.returnType,returnType)
				) {
					// TODO: consolidate error handling
					reportTypeMismatch("Return type mismatch",funcSignatureType.returnType,returnType);
				}
			}
		},
	},
	Identifier(path) {
		// i.e., function foo(a = int) { .. }
		if (
			recognizedTypes.includes(path.node.name) &&
			T.isAssignmentPattern(path.parent)
		) {
			discoveredNodeTypes.set(path.node,{ tagged: path.node.name, });
		}
		else {
			// pull identifier binding's tagged-type (if any)
			let identifierType = getScopeBindingType(path.scope,path.node.name);
			if (identifierType) {
				discoveredNodeTypes.set(path.node,{ ...identifierType, });
			}
		}
	},
	Literal(path) {
		if (!T.isTemplateLiteral(path.node)) {
			let inferred =
				(typeof path.node.value == "string") ? "string" :
				(typeof path.node.value == "number") ? "number" :
				(typeof path.node.value == "boolean") ? "bool" :
				(typeof path.node.value == "bigint") ? "bigint" :
				(path.node.value === null) ? "nul" :
				("value" in path.node && path.node.value === undefined) ? "undef" :
				"unknown";

			discoveredNodeTypes.set(path.node,{ inferred, });
		}
	},
};

var visitorHelpers = {
	BinaryPlus: {
		exit(path) {
			var [leftType,rightType] = binaryExpressionTypes(path.node);
			var exprType =
				(typesMatch(leftType,rightType)) ? leftType :
				(extractType(leftType) != "unknown") ? leftType :
				(extractType(rightType) != "unknown") ? rightType :
				{ inferred: "unknown", };

			discoveredNodeTypes.set(path.node,exprType);
			console.log(`Binary Expression: '${extractType(exprType)}' (type '${extractType(leftType)}' + type '${extractType(rightType)}')`);
		},
	},
};

Object.assign(module.exports,{
	check,
});


// ***********************************

function reportTypeMismatch(label,expectedType,foundType) {
	var expected =
		expectedType.tagged ? expectedType.tagged :
		expectedType.inferred ? expectedType.inferred :
		"unknown";
	var found =
		foundType.tagged ? foundType.tagged :
		foundType.inferred ? foundType.inferred :
		"unknown";

	console.error(`${label}: expected type '${expected}', but found type '${found}'`);
}

function handleAssignmentExpressionType(scope,exprNode,targetNode,sourceNode) {
	// target is simple identifier?
	if (T.isIdentifier(targetNode)) {
		let targetType = getScopeBindingType(scope,targetNode.name);
		let sourceType = discoveredNodeTypes.get(sourceNode);

		// source expression has a discovered type?
		if (sourceType) {
			discoveredNodeTypes.set(targetNode,{ ...sourceType, });
			if (exprNode) {
				discoveredNodeTypes.set(exprNode,{ ...sourceType, });
			}

			// no target identifier type?
			if (!targetType) {
				setScopeBindingType(scope,targetNode.name,sourceType);
			}
			else if (!typesMatch(targetType,sourceType)) {
				// TODO: consolidate error handling
				reportTypeMismatch("Assignment type mismatch",targetType,sourceType);
			}
		}
	}
	// target is array destructuring pattern?
	else if (
		T.isArrayPattern(targetNode) &&
		T.isArrayExpression(sourceNode)
	) {
		for (let [idx,targetElem] of targetNode.elements.entries()) {
			// target is identifier with a default = value assignment?
			if (T.isAssignmentPattern(targetElem)) {
				targetElem = targetElem.left;
			}
			let sourceElem = sourceNode.elements[idx];
			if (sourceElem) {
				handleAssignmentExpressionType(scope,null,targetElem,sourceElem);
			}
		}
	}
	// target is object destructuring pattern?
	else if (
		T.isObjectPattern(targetNode) &&
		T.isObjectExpression(sourceNode)
	) {
		for (let [idx,targetProp] of targetNode.properties.entries()) {
			let targetPropName = targetProp.key.name;
			targetProp = targetProp.value;

			// target is identifier with a default = value assignment?
			if (T.isAssignmentPattern(targetProp)) {
				targetProp = targetProp.left;
			}

			let sourceProp = sourceNode.properties.find(function matchProp(prop){
				return (
					(T.isIdentifier(prop.key) && targetPropName === prop.key.name) ||
					(T.isLiteral(prop.key) && targetPropName === prop.key.value)
				);
			});

			if (sourceProp) {
				handleAssignmentExpressionType(scope,null,targetProp,sourceProp.value);
			}
		}
	}
}

function setScopeBindingType(scope,name,type) {
	var binding = scope.getBinding(name);
	// found a scope binding with no tagged type?
	if (
		binding &&
		!discoveredNodeTypes.has(binding)
	) {
		discoveredNodeTypes.set(binding,{ ...type, });
		if (type.tagged) {
			console.log(`Tagging ${name} with type '${type.tagged}'`);
		}
		else {
			console.log(`Inferencing ${name} to type '${type.inferred}'`);
		}
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
			discoveredNodeTypes.get(node.left) :
			{ inferred: "unknown", },
		discoveredNodeTypes.has(node.right) ?
			discoveredNodeTypes.get(node.right) :
			{ inferred: "unknown", },
	];
}

function typesMatch(type1,type2) {
	return (
		(type1.tagged && type1.tagged === type2.tagged) ||
		(type1.tagged && type1.tagged === type2.inferred) ||
		(type1.inferred && type1.inferred === type2.tagged) ||
		(type1.inferred && type1.inferred === type2.inferred)
	);
}

function extractType(type) {
	return (
		!type ? "unknown" :
		type.tagged ? type.tagged :
		type.inferred ? type.inferred :
		"unknown"
	);
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
