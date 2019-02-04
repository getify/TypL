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
			// binary numeric expression?
			if (
				[
					"+", "-", "*", "/", "&", "|",
					"^", "<<", ">>", ">>>"
				].includes(path.node.operator)
			) {
				let whichHandler =
					path.node.operator == "+" ? "BinaryPlus" :
					path.node.operator == "-" ? "BinaryMinus" :
					path.node.operator == "*" ? "BinaryMult" :
					path.node.operator == "/" ? "BinaryDiv" :
					path.node.operator == "&" ? "BinaryAnd" :
					path.node.operator == "|" ? "BinaryOr" :
					path.node.operator == "^" ? "BinaryXOr" :
					path.node.operator == "<<" ? "BinaryLeftShift" :
					path.node.operator == ">>" ? "BinaryRightSignedShift" :
					path.node.operator == ">>>" ? "BinaryRightZeroShift" :
					"";

				return dispatchVisitor.call(this,visitorHelpers,whichHandler,[path,...rest],"exit");
			}
		},
	},
	Function: {
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

			if (T.isIdentifier(path.node.id)) {
				let funcType = {
					[isTaggedType(funcSignatureType) ? "tagged" : "inferred"]: extractTypeID(funcSignatureType)
				};
				setScopeBindingType(path.scope,path.node.id.name,funcType);
			}

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
					reportUnexpectedType("Return type mismatch",funcSignatureType.returnType,returnType);
				}
			}
		},
	},
	Identifier(path) {
		// type ID as default value in Assignment Pattern (i.e., `= int`):
		//   function foo(a = int) { .. }
		//   [ a = int ] = ..
		//   { b: B = int } = ..
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
				(typeof path.node.value == "bigint") ? "bint" :
				(path.node.value === null) ? "nul" :
				("value" in path.node && path.node.value === undefined) ? "undef" :
				"unknown";

			discoveredNodeTypes.set(path.node,{ inferred, });
		}
	},
	CallExpression: {
		exit(path) {
			if (
				T.isIdentifier(path.node.callee) &&
				path.node.callee.name == "BigInt"
			) {
				discoveredNodeTypes.set(path.node,{ inferred: "bint", });
			}
		},
	},
};

var visitorHelpers = {
	BinaryPlus: {
		exit(path) {
			var [leftType,rightType] = binaryExpressionTypes(path.node);
			var leftTypeID = extractTypeID(leftType);
			var rightTypeID = extractTypeID(rightType);

			// is either operand a string? + is overloaded to prefer
			//   string concatenation if so.
			if (
				leftTypeID == "string" ||
				rightTypeID == "string"
			) {
				if (
					leftTypeID == "string" &&
					rightTypeID == "string"
				) {
					if (
						isTaggedType(leftType) &&
						isTaggedType(rightType)
					) {
						discoveredNodeTypes.set(path.node,{ tagged: "string", });
					}
					else {
						discoveredNodeTypes.set(path.node,{ inferred: "string", });
					}
				}
				else {
					discoveredNodeTypes.set(path.node,{ inferred: "string", });
					reportTypeMismatch("Binary `+` operation, mixed operand types",leftType,rightType);
				}
			}
			else {
				handleBinaryNumeric("+",path.node);
			}
		},
	},
	BinaryMinus: {
		exit(path) {
			handleBinaryNumeric("-",path.node);
		},
	},
	BinaryMult: {
		exit(path) {
			handleBinaryNumeric("*",path.node);
		},
	},
	BinaryDiv: {
		exit(path) {
			handleBinaryNumeric("/",path.node);
		},
	},
	BinaryAnd: {
		exit(path) {
			handleBinaryNumeric("&",path.node);
		}
	},
	BinaryOr: {
		exit(path) {
			handleBinaryNumeric("|",path.node);
		}
	},
	BinaryXOr: {
		exit(path) {
			handleBinaryNumeric("^",path.node);
		}
	},
	BinaryLeftShift: {
		exit(path) {
			handleBinaryNumeric("<<",path.node);
		}
	},
	BinaryRightSignedShift: {
		exit(path) {
			handleBinaryNumeric(">>",path.node);
		}
	},
	BinaryRightZeroShift: {
		exit(path) {
			handleBinaryNumeric(">>>",path.node);
		}
	},
};

Object.assign(module.exports,{
	check,
});


// ***********************************

function reportTypeMismatch(label,type1,type2) {
	var type1ID = typeof type1 == "string" ? type1 : extractTypeID(type1);
	var type2ID = typeof type2 == "string" ? type2 : extractTypeID(type2);

	console.error(`${label}: type '${type1ID}' and type '${type2ID}'`);
}

function reportUnexpectedType(label,expectedType,foundType) {
	var expectedID =
		typeof expectedType == "string" ?
			expectedType :
			extractTypeID(expectedType);
	var foundID =
		typeof foundType == "string" ?
			foundType :
			extractTypeID(foundType);

	console.error(`${label}: expected type '${expectedID}', but found type '${foundID}'`);
}

function handleBinaryNumeric(opKind,exprNode) {
	var [leftType,rightType] = binaryExpressionTypes(exprNode);
	var leftTypeID = extractTypeID(leftType);
	var rightTypeID = extractTypeID(rightType);
	var numericTypeIDs = ["number","finite","int"];

	if (
		numericTypeIDs.includes(leftTypeID) &&
		numericTypeIDs.includes(rightTypeID)
	) {
		if (typesMatch(leftType,rightType)) {
			if (
				isTaggedType(leftType) ||
				isTaggedType(rightType)
			) {
				discoveredNodeTypes.set(exprNode,{ tagged: "number", });
			}
			else {
				discoveredNodeTypes.set(exprNode,{ inferred: "number", });
			}
		}
		else {
			discoveredNodeTypes.set(exprNode,{ inferred: "number", });
			reportTypeMismatch(`Binary \`${opKind}\` operation, mixed numeric operand types`,leftType,rightType);
		}
	}
	else if (
		leftTypeID == "bint" &&
		rightTypeID == "bint"
	) {
		if (
			isTaggedType(leftType) ||
			isTaggedType(rightType)
		) {
			discoveredNodeTypes.set(exprNode,{ tagged: "bint", });
		}
		else {
			discoveredNodeTypes.set(exprNode,{ inferred: "bint", });
		}
	}
	else {
		discoveredNodeTypes.set(exprNode,{ inferred: "number", });
		if (!numericTypeIDs.includes(leftTypeID)) {
			reportUnexpectedType(`Binary \`${opKind}\` operation, unexpected operand type`,"number",leftType);
		}
		else {
			reportUnexpectedType(`Binary \`${opKind}\` operation, unexpected operand type`,"number",rightType);
		}
	}
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
				reportUnexpectedType("Assignment type mismatch",targetType,sourceType);
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

function setScopeBindingType(scope,bindingName,type) {
	var binding = scope.getBinding(bindingName);
	// found a scope binding with no tagged type?
	if (
		binding &&
		!discoveredNodeTypes.has(binding)
	) {
		discoveredNodeTypes.set(binding,{ ...type, });
		let typeID = extractTypeID(type);
		if (isTaggedType(type)) {
			console.log(`Tagging ${bindingName} with type '${typeID}'`);
		}
		else {
			console.log(`Inferencing ${bindingName} to type '${typeID}'`);
		}
	}
}

function getScopeBindingType(scope,bindingName) {
	var binding = scope.getBinding(bindingName);
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
	var typeID1 = extractTypeID(type1);
	var typeID2 = extractTypeID(type2);
	return (
		typeID1 != "unknown" &&
		typeID2 != "unknown" &&
		typeID1 === typeID2
	);
}

function isSafeSubsetType(type1,type2) {
	var typeID1 = extractTypeID(type1);
	var typeID2 = extractTypeID(type2);
	if (typeID1 == "number") {
		return ["number","finite","int"].includes(typeID2);
	}
	else if (typeID1 == "finite") {
		return ["finite","int"].includes(typeID2);
	}
}

function isTaggedType(type) {
	return "tagged" in type;
}

function isInferredType(type) {
	return "inferred" in type;
}

function extractTypeID(type) {
	return (
		!type ? "unknown" :
		isTaggedType(type) ? type.tagged :
		isInferredType(type) ? type.inferred :
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
