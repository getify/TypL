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
	SequenceExpression: {
		exit(path) {
			if (path.node.expressions.length > 0) {
				let lastExprType = discoveredNodeTypes.get(path.node.expressions[path.node.expressions.length - 1]);
				if (lastExprType) {
					discoveredNodeTypes.set(path.node,{ ...lastExprType, });
				}
			}
		},
	},
	UpdateExpression: {
		exit(path) {
			if ([ "++", "--", ].includes(path.node.operator)) {
				handleUnaryNumeric(path.node.operator,path.node);
			}
		},
	},
	UnaryExpression: {
		exit(path) {
			if (path.node.operator == "void") {
				discoveredNodeTypes.set(path.node,{ inferred: "undef", });
			}
			else if (path.node.operator == "typeof") {
				discoveredNodeTypes.set(path.node,{ inferred: "string", });
			}
			else if (path.node.operator == "~") {
				handleUnaryNumeric(path.node.operator,path.node);
			}
			// numeric coercion operators
			else if ([ "+", "-", ].includes(path.node.operator)) {
				discoveredNodeTypes.set(path.node,{ inferred: "number", });
			}
			// boolean coercion operators
			else if ([ "!", "delete", ].includes(path.node.operator)) {
				discoveredNodeTypes.set(path.node,{ inferred: "bool", });
			}
		},
	},
	BinaryExpression: {
		exit(path) {
			// binary numeric plus?
			if (path.node.operator == "+") {
				handleBinaryPlus(path.node);
			}
			else if ([ "in", "instanceof" ].includes(path.node.operator)) {
				discoveredNodeTypes.set(path.node,{ inferred: "bool", });
			}
			// numeric/mathematical operators?
			else if (
				[
					"%", "-", "*", "/", "&", "|", "^", "<<", ">>", ">>>",
				].includes(path.node.operator)
			) {
				handleBinaryNumeric(path.node.operator,path.node);
			}
			// relative comparison operators?
			else if (
				[ "<", ">", "<=", ">=", ].includes(path.node.operator)
			) {
				handleBinaryRelativeComparison(path.node.operator,path.node);
			}
			// equality comparison operators?
			else if (
				[ "==", "!=", "===", "!==", ].includes(path.node.operator)
			) {
				handleBinaryEquality(path.node.operator,path.node);
			}
		},
	},
	LogicalExpression: {
		exit(path) {
			handleBinarySelection(path.node,path.node.left,path.node.right);
		},
	},
	ConditionalExpression: {
		exit(path) {
			var condType = discoveredNodeTypes.get(path.node.test);
			var condTypeID = getTypeID(condType);
			if (
				condTypeID != "bool"
			) {
				reportUnexpectedType("Ternary expression, unexpected condition type",condTypeID,"bool");
			}

			// select the type from the then/else clauses
			handleBinarySelection(path.node,path.node.consequent,path.node.alternate);
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
					[isTaggedType(funcSignatureType) ? "tagged" : "inferred"]: getTypeID(funcSignatureType)
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
					reportUnexpectedType("Return type mismatch",returnType,funcSignatureType.returnType);
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

Object.assign(module.exports,{
	check,
});


// ***********************************

function reportTypeMismatch(label,type1,type2) {
	var type1ID = getTypeID(type1);
	var type2ID = getTypeID(type2);
	console.error(`${label}: type '${type1ID}' and type '${type2ID}'`);
}

function reportUnexpectedType(label,foundType,expectedType) {
	var foundID = getTypeID(foundType);
	if (expectedType) {
		let expectedID = getTypeID(expectedType);
		if (foundID == "unknown") {
			console.error(`${label}: expected type '${expectedID}', but type could not be determined`);
		}
		else {
			console.error(`${label}: expected type '${expectedID}', but found type '${foundID}'`);
		}
	}
	else {
		if (foundID == "unknown") {
			console.error(`${label}: type could not be determined`);
		}
		else {
			console.error(`${label}: found type '${foundID}'`);
		}
	}
}

function handleBinarySelection(exprNode,leftNode,rightNode) {
	var leftType = discoveredNodeTypes.get(leftNode);
	var rightType = discoveredNodeTypes.get(rightNode);
	var leftTypeID = getTypeID(leftType);
	var rightTypeID = getTypeID(rightType);

	if (typesMatch(leftTypeID,rightTypeID)) {
		if (
			isTaggedType(leftType) ||
			isTaggedType(rightType)
		) {
			discoveredNodeTypes.set(exprNode,{ tagged: leftTypeID, });
		}
		else {
			discoveredNodeTypes.set(exprNode,{ inferred: leftTypeID, });
		}
	}
}

function handleBinaryPlus(exprNode) {
	var [leftType,rightType] = binaryExpressionTypes(exprNode);
	var leftTypeID = getTypeID(leftType);
	var rightTypeID = getTypeID(rightType);

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
				isTaggedType(leftType) ||
				isTaggedType(rightType)
			) {
				discoveredNodeTypes.set(exprNode,{ tagged: "string", });
			}
			else {
				discoveredNodeTypes.set(exprNode,{ inferred: "string", });
			}
		}
		else {
			discoveredNodeTypes.set(exprNode,{ inferred: "string", });
			reportTypeMismatch("Binary `+` operation, mixed operand types",leftType,rightType);
		}
	}
	else {
		handleBinaryNumeric("+",exprNode);
	}
}

function handleUnaryNumeric(op,exprNode) {
	var argType = discoveredNodeTypes.get(exprNode.argument);
	var argTypeID = getTypeID(argType);

	discoveredNodeTypes.set(exprNode,{ inferred: "number", });

	if (!isNumberOrSubtype(argTypeID)) {
		reportUnexpectedType(`Unary \`${op}\` operation, unexpected operand type`,argTypeID,"number");
	}
}

function handleBinaryNumeric(op,exprNode) {
	var [leftType,rightType] = binaryExpressionTypes(exprNode);
	var leftTypeID = getTypeID(leftType);
	var rightTypeID = getTypeID(rightType);
	var numericTypeIDs = [ "number", "finite", "int", ];

	if (
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
	else if (op == "%") {
		if (
			leftTypeID == "int" &&
			leftTypeID == rightTypeID &&
			isTaggedType(leftType) &&
			isTaggedType(rightType)
		) {
			discoveredNodeTypes.set(exprNode,{ tagged: "int", });
		}
		else {
			discoveredNodeTypes.set(exprNode,{ inferred: "int", });

			if (!(
				numericTypeIDs.includes(leftTypeID) &&
				numericTypeIDs.includes(rightTypeID)
			)) {
				if (typesMatch(leftTypeID,rightTypeID)) {
					reportUnexpectedType("Binary `%` operation, operand types match but are unexpected",leftTypeID,"number");
				}
				else {
					if (!numericTypeIDs.includes(leftTypeID)) {
						reportUnexpectedType("Binary `%` operation, unexpected operand type",leftTypeID,"number");
					}
					if (!numericTypeIDs.includes(rightTypeID)) {
						reportUnexpectedType("Binary `%` operation, unexpected operand type",rightTypeID,"number");
					}
				}
			}
		}
	}
	else if (
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
			reportTypeMismatch(`Binary \`${op}\` operation, mixed numeric operand types`,leftType,rightType);
		}
	}
	else {
		discoveredNodeTypes.set(exprNode,{ inferred: "number", });
		if (!numericTypeIDs.includes(leftTypeID)) {
			reportUnexpectedType(`Binary \`${op}\` operation, unexpected operand type`,leftType,"number");
		}
		if (!numericTypeIDs.includes(rightTypeID)) {
			reportUnexpectedType(`Binary \`${op}\` operation, unexpected operand type`,rightType,"number");
		}
	}
}

function handleBinaryRelativeComparison(op,exprNode) {
	var [leftType,rightType] = binaryExpressionTypes(exprNode);
	var leftTypeID = getTypeID(leftType);
	var rightTypeID = getTypeID(rightType);
	var validIDs = [ "string", "number", "finite", "int", "bint", ];

	discoveredNodeTypes.set(exprNode,{ inferred: "bool", });

	if (typesMatch(leftTypeID,rightTypeID)) {
		if (!validIDs.includes(leftTypeID)) {
			reportUnexpectedType(`Binary \`${op}\` operation, operand types match but are unexpected`,leftType,"number|string");
		}
	}
	else if (
		validIDs.includes(leftTypeID) &&
		validIDs.includes(rightTypeID)
	) {
		if (
			(leftTypeID == "string" && isNumberOrSubtype(rightTypeID)) ||
			(isNumberOrSubtype(leftTypeID) && rightTypeID == "string")
		) {
			reportTypeMismatch(`Binary \`${op}\` operation, mixed operand types`,leftTypeID,rightTypeID);
		}
	}
	else {
		if (!validIDs.includes(leftTypeID)) {
			reportUnexpectedType(`Binary \`${op}\` operation, unexpected operand type`,leftTypeID,"number|string");
		}
		if (!validIDs.includes(rightTypeID)) {
			reportUnexpectedType(`Binary \`${op}\` operation, unexpected operand type`,rightTypeID,"number|string");
		}
	}
}

function handleBinaryEquality(op,exprNode) {
	var [leftType,rightType] = binaryExpressionTypes(exprNode);
	var leftTypeID = getTypeID(leftType);
	var rightTypeID = getTypeID(rightType);

	discoveredNodeTypes.set(exprNode,{ inferred: "bool", });

	if (["==","!="].includes(op)) {
		if (!(
			typesMatch(leftTypeID,rightTypeID) ||
			(
				isNumberOrSubtype(leftTypeID) &&
				isNumberOrSubtype(rightTypeID)
			)
		)) {
			reportTypeMismatch(`Binary \`${op}\` operation, mixed operand types`,leftTypeID,rightTypeID);
		}
	}
	else if (["===","!=="].includes(op)) {
		if (
			leftTypeID != "unknown" &&
			rightTypeID != "unknown"
		) {
			if (
				typesMatch(leftTypeID,rightTypeID) ||
				(
					isNumberOrSubtype(leftTypeID) &&
					isNumberOrSubtype(rightTypeID)
				)
			) {
				reportUnexpectedType(`Binary \`${op}\` operation, unexpectedly matching operand types`,leftTypeID);
			}
			else {
				reportTypeMismatch(`Binary \`${op}\` operation, mixed operand types`,leftTypeID,rightTypeID);
			}
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
		let typeID = getTypeID(type);
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
	var type1ID = getTypeID(type1);
	var type2ID = getTypeID(type2);
	return (
		type1ID != "unknown" &&
		type2ID != "unknown" &&
		type1ID === type2ID
	);
}

function isNumberOrSubtype(type) {
	var typeID = getTypeID(type);
	return (typeID == "number" || isFiniteOrSubtype(typeID));
}

function isFiniteOrSubtype(type) {
	var typeID = getTypeID(type);
	return ["finite","int","bint"].includes(typeID);
}

function isTaggedType(type) {
	return (type && "tagged" in type);
}

function isInferredType(type) {
	return (type && "inferred" in type);
}

function getTypeID(type) {
	return (
		typeof type == "string" ? type :
		isTaggedType(type) ? type.tagged :
		isInferredType(type) ? type.inferred :
		"unknown"
	);
}

function check(code) {
	var ast = babylon.parse(code);
	traverse(ast,visitors);
	return ast;
}
