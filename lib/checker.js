"use strict";

var { default: traverse, } = require("@babel/traverse");
var T = require("@babel/types");
var babylon = require("babylon");

var recognizedTypeIDs = [
	"any", "undef", "nul", "string", "bool",
	"number", "finite", "int", "bint", "symb",
	"array", "object", "func", "regex",
];

var MSG = {
	INFO_FUNC_SIGNATURE: 101,
	INFO_REIMPLY_UNDEF_TAGGED: 102,
	INFO_REIMPLY_UNDEF_INFERRED: 103,
	INFO_IMPLY_PARAM_FROM_ARG_TAGGED: 104,
	INFO_IMPLY_PARAM_FROM_ARG_INFERRED: 105,
	INFO_IMPLY_VAR_TAGGED: 106,
	INFO_IMPLY_VAR_INFERRED: 107,

	ERR_REST_UNDECLARED: 108,
	ERR_REST_TYPE: 109,
	ERR_ASSIGNMENT_UNDECLARED: 110,
	ERR_ASSIGNMENT_TYPE: 111,
	ERR_ASSIGNMENT_SIGNATURE: 112,
	ERR_CALL_ARG_PARAM_COUNT: 113,
	ERR_CALL_ARG_TYPE: 114,
	ERR_CALL_ARG_SIGNATURE: 115,
	ERR_BINARY_PLUS_MIXED_TYPES: 116,
	ERR_RELATIVE_OP_MIXED_TYPES: 117,
	ERR_RELATIVE_OP_BOTH_TYPES: 118,
	ERR_RELATIVE_OP_TYPE: 119,
	ERR_LOOSE_EQUALITY_MIXED_TYPES: 120,
	ERR_STRICT_EQUALITY_KNOWN_MIXED_TYPES: 121,
	ERR_STRICT_EQUALITY_KNOWN_MATCHING_TYPES: 122,
	ERR_UNARY_NUMERIC_OP_TYPE: 123,
	ERR_MODULUS_OP_BOTH_TYPES: 124,
	ERR_MODULUS_OP_TYPE: 125,
	ERR_BINARY_NUMERIC_OP_TYPE: 126,
	ERR_FUNC_RETURN_TYPE: 127,
	ERR_FUNC_RETURN_SIGNATURE: 128,
	ERR_TERNARY_COND_TYPE: 129,
};

var outputMessages = [];

// store any tagged or inferred types for nodes, or
// implied types for bindings
var nodeTypes = new WeakMap();

// store any type signatures (functions, objects,
// arrays, etc)
var typeSignatures = new WeakMap();

// store references from signatures back to their
// AST node-paths
var signatureNodePaths = new WeakMap();


var collectTypesVisitors = {
	TaggedTemplateExpression(path) {
		if (T.isIdentifier(path.node.tag)) {
			let tagName = path.node.tag.name;
			if (recognizedTypeIDs.includes(tagName)) {
				nodeTypes.set(path.node,{ tagged: tagName, });
			}
		}
	},
	TemplateLiteral(path) {
		if (T.isTaggedTemplateExpression(path.parent)) {
			let parentType = nodeTypes.get(path.parent);
			if (parentType) {
				nodeTypes.set(path.node,{ ...parentType, });
			}
			else {
				nodeTypes.set(path.node,{ inferred: "unknown", });
			}
		}
		else {
			nodeTypes.set(path.node,{ inferred: "string", });
		}
	},
	VariableDeclarator: {
		exit(path) {
			// does the declarator have an init expression?
			if (path.node.init) {
				handleAssignmentExpressionType(path.scope,path.node,path.node.id,path.node.init);
			}
			else {
				setScopeBindingType(path.scope,path.node.id.name,{ inferred: "undef", });
			}
		},
	},
	// default = value assignment (param, destructuring)
	AssignmentPattern: {
		exit(path) {
			handleAssignmentExpressionType(path.scope,path.node,path.node.left,path.node.right);
		},
	},
	AssignmentExpression: {
		exit(path) {
			handleAssignmentExpressionType(path.scope,path.node,path.node.left,path.node.right);
		},
	},
	SequenceExpression: {
		exit(path) {
			if (path.node.expressions.length > 0) {
				let lastExprType = nodeTypes.get(path.node.expressions[path.node.expressions.length - 1]);
				if (lastExprType) {
					nodeTypes.set(path.node,{ ...lastExprType, });
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
	NewExpression: {
		exit(path) {
			nodeTypes.set(path.node,{ inferred: "object", });
		},
	},
	UnaryExpression: {
		exit(path) {
			if (path.node.operator == "void") {
				nodeTypes.set(path.node,{ inferred: "undef", });
			}
			else if (path.node.operator == "typeof") {
				nodeTypes.set(path.node,{ inferred: "string", });
			}
			else if (path.node.operator == "~") {
				handleUnaryNumeric(path.node.operator,path.node);
			}
			// numeric coercion operators
			else if ([ "+", "-", ].includes(path.node.operator)) {
				nodeTypes.set(path.node,{ inferred: "number", });
			}
			// boolean coercion operators
			else if ([ "!", "delete", ].includes(path.node.operator)) {
				nodeTypes.set(path.node,{ inferred: "bool", });
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
				nodeTypes.set(path.node,{ inferred: "bool", });
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
				handleEquality(path.node.operator,path.node);
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
			var condType = nodeTypes.get(path.node.test);
			var condTypeID = getTypeID(condType);
			if (
				condTypeID != "bool"
			) {
				reportUnexpectedType(
					MSG.ERR_TERNARY_COND_TYPE,
					"Ternary `?:` expression, unexpected condition type",
					condTypeID,
					"bool",
					path.node.test
				);
			}

			// select the type from the then/else clauses
			handleBinarySelection(path.node,path.node.consequent,path.node.alternate);
		},
	},
	Function: {
		enter(path) {
			nodeTypes.set(path.node,{ inferred: "func", });

			// setup default type signature for function
			var funcSignature = {
				type: "func",
				params: [],
				hasRestParam: false,
				"return": {
					default: true,
					inferred: "undef",
				},
			};
			typeSignatures.set(path.node,funcSignature);
			signatureNodePaths.set(funcSignature,path);
		},
		exit(path) {
			var funcSignature = typeSignatures.get(path.node);

			// exiting an arrow function with expression body?
			if (
				T.isArrowFunctionExpression(path.node) &&
				T.isExpression(path.node.body)
			) {
				delete funcSignature.return.default;
				delete funcSignature.return.inferred;

				let returnType;
				if (nodeTypes.has(path.node.body)) {
					returnType = nodeTypes.get(path.node.body);
				}
				else {
					returnType = { inferred: "unknown", };
				}
				Object.assign(funcSignature.return,returnType);

				// does this function's return value have its own type signature?
				let returnSignature = typeSignatures.get(path.node.body);
				if (returnSignature) {
					typeSignatures.set(funcSignature.return,returnSignature);
				}
			}

			addOutputMessage({
				id: MSG.INFO_FUNC_SIGNATURE,
				text: `Function '${getOrInferFunctionName(path)}' signature: ${JSON.stringify(funcSignature)}`,
				node: path.node,
			});
		},
	},
	ReturnStatement: {
		exit(path) {
			var funcNode = path.getFunctionParent().node;
			var funcSignature = typeSignatures.get(funcNode);

			if (funcSignature) {
				// NOT just a PTC self-recursive return (which we will
				//   skip func-signature registration for)?
				if (!(
					funcNode.id &&
					T.isIdentifier(funcNode.id) &&
					path.node.argument &&
					T.isCallExpression(path.node.argument) &&
					T.isIdentifier(path.node.argument.callee) &&
					funcSignature == getScopeBindingSignature(path.scope,path.node.argument.callee.name)
				)) {
					let returnType;
					if (path.node.argument) {
						if (nodeTypes.has(path.node.argument)) {
							returnType = nodeTypes.get(path.node.argument);
						}
						else {
							returnType = { inferred: "unknown", };
						}
					}
					else {
						returnType = { inferred: "undef", };
					}
					let functionReturnSignature = typeSignatures.get(funcSignature.return);
					let returnSignature = typeSignatures.get(path.node.argument);

					// first encountered `return` in the function?
					if (funcSignature.return.default === true) {
						delete funcSignature.return.default;
						delete funcSignature.return.inferred;
						Object.assign(funcSignature.return,returnType);

						// does this function's return value have its own signature?
						if (returnSignature) {
							typeSignatures.set(funcSignature.return,returnSignature);
						}
					}
					// return types mismatched?
					else if (!typesMatch(returnType,funcSignature.return)) {
						reportUnexpectedType(
							MSG.ERR_FUNC_RETURN_TYPE,
							"Return type mismatched",
							returnType,
							funcSignature.returnType,
							path.node.argument
						);
					}
					// return type signatures mismatched?
					else if (
						functionReturnSignature &&
						returnSignature &&
						!signaturesMatch(returnSignature,functionReturnSignature)
					) {
						reportUnexpectedSignature(
							MSG.ERR_FUNC_RETURN_SIGNATURE,
							"Return type signature mismatched",
							returnSignature,
							functionReturnSignature,
							path.node.argument
						);
					}
				}
			}
		},
	},
	Identifier(path) {
		if (recognizedTypeIDs.includes(path.node.name)) {
			// type ID as default value in Assignment Pattern (i.e., `= int`):
			//   function foo(a = int) { .. }
			//   [ a = int ] = ..
			//   { b: B = int } = ..
			if (T.isAssignmentPattern(path.parent)) {
				// NOTE: this assignment-pattern will be compiled away most likely
				nodeTypes.set(path.node,{ tagged: path.node.name, });
			}
			else {
				nodeTypes.set(path.node,{ inferred: "func", });
			}
		}
		// function name identifier?
		else if (
			T.isFunction(path.parent) &&
			path.parent.id &&
			path.parent.id == path.node
		) {
			handleAssignmentExpressionType(path.scope,path.parent,path.node,path.parent);
		}
		// any other identifier?
		else {
			let identifierType = getScopeBindingType(path.scope,path.node.name);
			let identifierSignature = getScopeBindingSignature(path.scope,path.node.name);

			// does identifier's binding have an implied-type from any scope?
			if (identifierType) {
				nodeTypes.set(path.node,{ ...identifierType, });
				if (identifierSignature) {
					typeSignatures.set(path.node,identifierSignature);
				}
			}
			// is there a non-param binding for this specific scope?
			else if (
				path.scope.bindings &&
				path.node.name in path.scope.bindings &&
				path.scope.bindings[path.node.name].kind != "param"
			) {
				nodeTypes.set(path.node,{ inferred: "undef", });
			}
			// is the `undefined` keyword (identifier) being used?
			//   NOTE: assume no re-assignment of `undefined`
			else if (path.node.name == "undefined") {
				nodeTypes.set(path.node,{ inferred: "undef", });
			}
		}
	},
	BlockStatement(path) {
		// entering a function body (just finished the parameters)?
		if (T.isFunction(path.parent,{ body: path.node, })) {
			registerFuncSignatureParams(path.parentPath);
		}
	},
	Expression(path) {
		// entering an arrow function expression (just finished the parameters)?
		if (T.isArrowFunctionExpression(path.parent,{ body: path.node, })) {
			registerFuncSignatureParams(path.parentPath);
		}
	},
	ArrayExpression: {
		exit(path) {
			nodeTypes.set(path.node,{ inferred: "array", });
		},
	},
	ArrayPattern: {
		exit(path) {
			nodeTypes.set(path.node,{ inferred: "array", });
		},
	},
	ObjectExpression: {
		exit(path) {
			nodeTypes.set(path.node,{ inferred: "object", });
		},
	},
	ObjectPattern: {
		exit(path) {
			nodeTypes.set(path.node,{ inferred: "object", });
		},
	},
	NullLiteral: {
		exit(path) {
			nodeTypes.set(path.node, { inferred: "nul", });
		},
	},
	Literal(path) {
		if (!T.isTemplateLiteral(path.node)) {
			let inferred =
				(typeof path.node.value == "string") ? "string" :
				(typeof path.node.value == "number") ? "number" :
				(typeof path.node.value == "boolean") ? "bool" :
				(typeof path.node.value == "bigint") ? "bint" :
				("value" in path.node && path.node.value === undefined) ? "undef" :
				"unknown";

			nodeTypes.set(path.node,{ inferred, });
		}
	},
	CallExpression: {
		exit(path) {
			handleCallExpression(path.scope,path.node);
		},
	},
	RestElement: {
		exit(path) {
			nodeTypes.set(path.node,{ inferred: "any", isRest: true, });
			var binding = path.scope.getBinding(path.node.argument.name);

			if (binding) {
				let type = nodeTypes.get(binding);
				if (getTypeID(type) == "unknown") {
					setScopeBindingType(path.scope,path.node.argument.name,{ inferred: "array", });
				}
				else if (getTypeID(type) != "array") {
					reportUnexpectedType(
						MSG.ERR_REST_TYPE,
						"Rest element type mismatch",
						type,
						"array",
						path.node
					);
				}
			}
			else {
				addOutputMessage({
					id: MSG.ERR_REST_UNDECLARED,
					type: "error",
					text: "Rest element assigning to unknown/undeclared variable",
					node: path.node,
				});
			}
		},
	},
};

Object.assign(module.exports,{
	check,
});


// ***********************************

function isFuncParam(path) {
	return (
		T.isFunction(path.parent) &&
		path.parent.params.includes(path.node)
	);
}

function atEndOfFuncParams(path) {
	if (isFuncParam(path)) {
		let params = path.parent.params;
		return (path.node == params[params.length - 1]);
	}
}

function registerFuncSignatureParams(path) {
	var funcNode = path.node;
	var funcSignature = typeSignatures.get(funcNode);

	for (let param of funcNode.params) {
		let paramType = nodeTypes.get(param);
		if (paramType) {
			// don't save a ...rest element into the signature,
			// but flag its presence (for signature checking)
			if (paramType.isRest) {
				funcSignature.hasRestParam = true;
			}
			else {
				paramType = { ...paramType, };
				funcSignature.params.push(paramType);

				// need to register a param's signature?
				let paramSignature = typeSignatures.get(param);
				if (paramSignature) {
					typeSignatures.set(paramType,paramSignature);
				}
			}
		}
		else {
			funcSignature.params.push({ inferred: "unknown", });
		}
	}
}

function getOrInferFunctionName(path) {
	var funcNode = path.node;
	var parentNode = path.parent;

	if (T.isIdentifier(funcNode.id)) {
		return funcNode.id.name;
	}
	else if (T.isObjectMethod(funcNode)) {
		let key = funcNode.key;
		if (T.isIdentifier(key)) {
			return key.name;
		}
		else if (T.isLiteral(key)) {
			return key.value;
		}
	}
	else if (T.isProperty(parentNode)) {
		let key = parentNode.key;
		if (T.isIdentifier(key)) {
			return key.name;
		}
		else if (T.isLiteral(key)) {
			return key.value;
		}
	}
	else if (
		T.isAssignmentExpression(parentNode) &&
		T.isIdentifier(parentNode.left)
	) {
		return parentNode.left.name;
	}
	else if (
		T.isVariableDeclarator(parentNode) &&
		T.isIdentifier(parentNode.id)
	) {
		return parentNode.id.name;
	}
	else {
		return "(anonymous)";
	}
}

function reportTypeMismatch(errID,label,type1,type2,node) {
	var type1ID = getTypeID(type1);
	var type2ID = getTypeID(type2);
	addOutputMessage({
		id: errID,
		type: "error",
		text: `${label}: type '${type1ID}' doesn't match type '${type2ID}'`,
		node,
	});
}

// function reportSignatureMismatch(errID,label,signature1,signature2,node) {
// 	addOutputMessage({
// 		id: errID,
// 		type: "error",
// 		text: `${label}: '${JSON.stringify(signature1)}' doesn't match '${JSON.stringify(signature2)}`,
// 		node,
// 	});
// }

function reportUnexpectedType(errID,label,foundType,expectedType,node) {
	var foundID = getTypeID(foundType);
	if (expectedType) {
		let expectedID = getTypeID(expectedType);
		if (foundID == "unknown") {
			addOutputMessage({
				id: errID,
				type: "error",
				text: `${label}: expected type '${expectedID}', but type could not be determined`,
				node,
			});
		}
		else {
			addOutputMessage({
				id: errID,
				type: "error",
				text: `${label}: expected type '${expectedID}', but found type '${foundID}'`,
				node,
			});
		}
	}
	else if (foundID == "unknown") {
		addOutputMessage({
			id: errID,
			type: "error",
			text: `${label}: type is unknown`,
			node,
		});
	}
	else {
		addOutputMessage({
			id: errID,
			type: "error",
			text: `${label}: found type '${foundID}'`,
			node,
		});
	}
}

function reportUnexpectedSignature(errID,label,foundSignature,expectedSignature,node) {
	addOutputMessage({
		id: errID,
		type: "error",
		text: `${label}: expected signature ${JSON.stringify(expectedSignature)}, but found signature ${JSON.stringify(foundSignature)}`,
		node,
	});
}

function handleBinarySelection(exprNode,leftNode,rightNode) {
	var leftType = nodeTypes.get(leftNode);
	var rightType = nodeTypes.get(rightNode);
	var leftTypeID = getTypeID(leftType);
	var rightTypeID = getTypeID(rightType);

	if (typesMatch(leftTypeID,rightTypeID)) {
		if (
			isTaggedType(leftType) ||
			isTaggedType(rightType)
		) {
			nodeTypes.set(exprNode,{ tagged: leftTypeID, });
		}
		else {
			nodeTypes.set(exprNode,{ inferred: leftTypeID, });
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
				nodeTypes.set(exprNode,{ tagged: "string", });
			}
			else {
				nodeTypes.set(exprNode,{ inferred: "string", });
			}
		}
		else {
			nodeTypes.set(exprNode,{ inferred: "string", });
			reportTypeMismatch(
				MSG.ERR_BINARY_PLUS_MIXED_TYPES,
				"Binary `+` operation, mixed operand types",
				rightType,
				leftType,
				exprNode
			);
		}
	}
	else {
		handleBinaryNumeric("+",exprNode);
	}
}

function handleUnaryNumeric(op,exprNode) {
	var argType = nodeTypes.get(exprNode.argument);
	var argTypeID = getTypeID(argType);

	nodeTypes.set(exprNode,{ inferred: "number", });

	if (!isNumberOrSubtype(argTypeID)) {
		reportUnexpectedType(
			MSG.ERR_UNARY_NUMERIC_OP_TYPE,
			`Unary \`${op}\` operation, unexpected operand type`,
			argTypeID,
			"number",
			exprNode.argument
		);
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
			nodeTypes.set(exprNode,{ tagged: "bint", });
		}
		else {
			nodeTypes.set(exprNode,{ inferred: "bint", });
		}
	}
	else if (op == "%") {
		if (
			leftTypeID == "int" &&
			leftTypeID == rightTypeID &&
			isTaggedType(leftType) &&
			isTaggedType(rightType)
		) {
			nodeTypes.set(exprNode,{ tagged: "int", });
		}
		else {
			nodeTypes.set(exprNode,{ inferred: "int", });

			if (!(
				numericTypeIDs.includes(leftTypeID) &&
				numericTypeIDs.includes(rightTypeID)
			)) {
				if (typesMatch(leftTypeID,rightTypeID)) {
					reportUnexpectedType(
						MSG.ERR_MODULUS_OP_BOTH_TYPES,
						"Binary `%` operation, operand types unexpected",
						leftTypeID,
						"number",
						exprNode
					);
				}
				else {
					if (!numericTypeIDs.includes(leftTypeID)) {
						reportUnexpectedType(
							MSG.ERR_MODULUS_OP_TYPE,
							"Binary `%` operation, unexpected operand type",
							leftTypeID,
							"number",
							exprNode.left
						);
					}
					if (!numericTypeIDs.includes(rightTypeID)) {
						reportUnexpectedType(
							MSG.ERR_MODULUS_OP_TYPE,
							"Binary `%` operation, unexpected operand type",
							rightTypeID,
							"number",
							exprNode.right
						);
					}
				}
			}
		}
	}
	else if (
		numericTypeIDs.includes(leftTypeID) &&
		numericTypeIDs.includes(rightTypeID)
	) {
		if (
			isTaggedType(leftType) ||
			isTaggedType(rightType)
		) {
			nodeTypes.set(exprNode,{ tagged: "number", });
		}
		else {
			nodeTypes.set(exprNode,{ inferred: "number", });
		}
	}
	else {
		nodeTypes.set(exprNode,{ inferred: "number", });
		if (!numericTypeIDs.includes(leftTypeID)) {
			reportUnexpectedType(
				MSG.ERR_BINARY_NUMERIC_OP_TYPE,
				`Binary \`${op}\` operation, unexpected operand type`,
				leftType,
				"number",
				exprNode.left
			);
		}
		if (!numericTypeIDs.includes(rightTypeID)) {
			reportUnexpectedType(
				MSG.ERR_BINARY_NUMERIC_OP_TYPE,
				`Binary \`${op}\` operation, unexpected operand type`,
				rightType,
				"number",
				exprNode.right
			);
		}
	}
}

function handleBinaryRelativeComparison(op,exprNode) {
	var [leftType,rightType] = binaryExpressionTypes(exprNode);
	var leftTypeID = getTypeID(leftType);
	var rightTypeID = getTypeID(rightType);
	var validIDs = [ "string", "number", "finite", "int", "bint", ];

	nodeTypes.set(exprNode,{ inferred: "bool", });

	if (typesMatch(leftTypeID,rightTypeID)) {
		if (!validIDs.includes(leftTypeID)) {
			reportUnexpectedType(
				MSG.ERR_RELATIVE_OP_BOTH_TYPES,
				`Binary \`${op}\` operation, operand types unexpected`,
				leftType,
				"number|string",
				exprNode
			);
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
			reportTypeMismatch(
				MSG.ERR_RELATIVE_OP_MIXED_TYPES,
				`Binary \`${op}\` operation, mixed operand types`,
				rightTypeID,
				leftTypeID,
				exprNode
			);
		}
	}
	else {
		if (!validIDs.includes(leftTypeID)) {
			reportUnexpectedType(
				MSG.ERR_RELATIVE_OP_TYPE,
				`Binary \`${op}\` operation, unexpected operand type`,
				leftTypeID,
				"number|string",
				exprNode.left
			);
		}
		if (!validIDs.includes(rightTypeID)) {
			reportUnexpectedType(
				MSG.ERR_RELATIVE_OP_TYPE,
				`Binary \`${op}\` operation, unexpected operand type`,
				rightTypeID,
				"number|string",
				exprNode.right
			);
		}
	}
}

function handleEquality(op,exprNode) {
	var [leftType,rightType] = binaryExpressionTypes(exprNode);
	var leftTypeID = getTypeID(leftType);
	var rightTypeID = getTypeID(rightType);

	nodeTypes.set(exprNode,{ inferred: "bool", });

	if (["==","!="].includes(op)) {
		if (!(
			typesMatch(leftTypeID,rightTypeID) ||
			(
				isNumberOrSubtype(leftTypeID) &&
				isNumberOrSubtype(rightTypeID)
			)
		)) {
			reportTypeMismatch(
				MSG.ERR_LOOSE_EQUALITY_MIXED_TYPES,
				`Equality \`${op}\` operation, mixed operand types`,
				rightTypeID,
				leftTypeID,
				exprNode
			);
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
				reportUnexpectedType(
					MSG.ERR_STRICT_EQUALITY_KNOWN_MATCHING_TYPES,
					`Strict equality \`${op}\`, known matching operand types`,
					leftTypeID,
					/*skipping=*/undefined,
					exprNode
				);
			}
			else {
				reportTypeMismatch(
					ERR.ERR_STRICT_EQUALITY_KNOWN_MIXED_TYPES,
					`Strict equality \`${op}\`, known mixed operand types`,
					rightTypeID,
					leftTypeID,
					exprNode
				);
			}
		}
	}
}

function handleAssignmentExpressionType(scope,exprNode,targetNode,sourceNode) {
	// target is simple identifier?
	if (T.isIdentifier(targetNode)) {
		let targetBinding = scope.getBinding(targetNode.name);

		if (targetBinding) {
			let targetType = nodeTypes.get(targetBinding);
			let targetSignature = typeSignatures.get(targetBinding);
			let sourceType = nodeTypes.get(sourceNode);
			let sourceTypeID = getTypeID(sourceType);
			let sourceSignature = typeSignatures.get(sourceNode);

			// source expression has a recognized type?
			if (sourceType && getTypeID(sourceType) != "unknown") {
				if (exprNode) {
					nodeTypes.set(exprNode,{ ...sourceType, });
				}
				// target already has an implied type?
				if (targetType) {
					if (!typesMatch(sourceType,targetType)) {
						if (targetType.inferred == "undef"){
							delete targetType.inferred;
							Object.assign(targetType,sourceType);

							// NOTE: temporary debugging output
							if (isTaggedType(sourceType)) {
								addOutputMessage({
									id: MSG.INFO_REIMPLY_UNDEF_TAGGED,
									text: `Re-implying ${targetNode.name} with tagged-type '${sourceTypeID}'`,
									node: targetNode,
								});
							}
							else {
								addOutputMessage({
									id: MSG.INFO_REIMPLY_UNDEF_INFERRED,
									text: `Re-implying ${targetNode.name} to inferred-type '${sourceTypeID}'`,
									node: targetNode,
								});
							}
						}
						else {
							reportUnexpectedType(
								MSG.ERR_ASSIGNMENT_TYPE,
								"Assignment type mismatch",
								sourceType,
								targetType,
								exprNode
							);
						}
					}
					else if (targetSignature) {
						if (!signaturesMatch(sourceSignature,targetSignature)) {
							reportUnexpectedSignature(
								MSG.ERR_ASSIGNMENT_SIGNATURE,
								"Assignment signature mismatch",
								sourceSignature,
								targetSignature,
								exprNode
							);
						}
					}
				}
				else {
					nodeTypes.set(targetNode,{ ...sourceType, });
					setScopeBindingType(scope,targetNode.name,sourceType);
				}

				// need to copy a reference to the type signature?
				if (
					!targetSignature &&
					sourceSignature
				) {
					typeSignatures.set(targetBinding,sourceSignature);
					if (exprNode) {
						typeSignatures.set(exprNode,sourceSignature);
					}
				}
			}
		}
		else {
			addOutputMessage({
				id: MSG.ERR_ASSIGNMENT_UNDECLARED,
				type: "error",
				text: "Assignment to an unknown/undeclared variable",
				node: targetNode,
			});
		}
	}
	// target is array destructuring pattern?
	else if (T.isArrayPattern(targetNode)) {
		if (exprNode) {
			let sourceType = nodeTypes.get(sourceNode);
			if (sourceType) {
				nodeTypes.set(exprNode,{ ...sourceType });
			}
			else {
				nodeTypes.set(exprNode,{ inferred: "array", });
			}
		}

		if (T.isArrayExpression(sourceNode)) {
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
	}
	// target is object destructuring pattern?
	else if (T.isObjectPattern(targetNode)) {
		if (exprNode) {
			let sourceType = nodeTypes.get(sourceNode);
			if (sourceType) {
				nodeTypes.set(exprNode,{ ...sourceType });
			}
			else {
				nodeTypes.set(exprNode,{ inferred: "object", });
			}
		}

		if (T.isObjectExpression(sourceNode)) {
			for (let [idx,targetProp] of targetNode.properties.entries()) {
				let targetPropName = targetProp.key.name;
				targetProp = targetProp.value;

				// target is identifier with a default = value assignment?
				if (T.isAssignmentPattern(targetProp)) {
					targetProp = targetProp.left;
				}

				let sourceProp = sourceNode.properties.find(function matchProp(prop){
					return (
						T.isIdentifier(prop.key,{ name: targetPropName, }) ||
						T.isLiteral(prop.key,{ value: targetPropName, })
					);
				});

				if (sourceProp) {
					handleAssignmentExpressionType(scope,null,targetProp,sourceProp.value);
				}
			}
		}
	}
}

function handleCallExpression(scope,callExprNode) {
	if (T.isIdentifier(callExprNode.callee)) {
		let calleeName = callExprNode.callee.name;
		let nativesReturnTypes = {
			"BigInt": "bint",
			"String": "string",
			"Number": "number",
			"Boolean": "bool",
			"Symbol": "symb",
			"Object": "object",
			"Array": "array",
			"Function": "func",
			"Date": "string",
			"RegExp": "object",
			"Error": "object",
			"SyntaxError": "object",
			"TypeError": "object",
			"ReferenceError": "object",
			"RangeError": "object",
			"URIError": "object",
			"EvalError": "object",
		};

		if (calleeName in nativesReturnTypes) {
			nodeTypes.set(callExprNode,{ inferred: nativesReturnTypes[calleeName], });
		}
		else {
			let funcSignature = getScopeBindingSignature(scope,calleeName);
			if (funcSignature) {
				let { default: tmp, ...returnType } = funcSignature.return;
				nodeTypes.set(callExprNode,{ ...returnType, });

				let funcReturnSignature = typeSignatures.get(funcSignature.return);
				if (funcReturnSignature) {
					typeSignatures.set(callExprNode,funcReturnSignature);
				}

				// collect argument-types (and signatures) for call-expression
				let callExpressionArgumentTypes = [];
				for (let arg of callExprNode.arguments) {
					let argType = nodeTypes.get(arg);
					if (argType) {
						argType = { ...argType, };
						callExpressionArgumentTypes.push(argType);

						// does the argument itself (object, array,
						// call-expression) have a signature?
						let argSignature = typeSignatures.get(arg);
						if (argSignature) {
							// register this argument signature against this
							// call-expression signature
							typeSignatures.set(argType,argSignature);
						}
					}
				}

				// check call-expression arguments against function parameters
				if (
					(
						!funcSignature.hasRestParam &&
						callExpressionArgumentTypes.length > funcSignature.params.length
					) ||
					(
						callExpressionArgumentTypes.length < funcSignature.params.length
					)
				) {
					addOutputMessage({
						id: MSG.ERR_CALL_ARG_PARAM_COUNT,
						type: "error",
						text: `Expected ${funcSignature.params.length} arguments, found ${callExpressionArgumentTypes.length}`,
						node: callExprNode,
					});
				}
				else {
					let funcNodePath = signatureNodePaths.get(funcSignature);
					let funcNodeScope = funcNodePath.scope;
					let funcNode = funcNodePath.node;

					// compare argument types/signatures to parameter types/signatures
					for (let [argIdx,argType] of callExpressionArgumentTypes.entries()) {
						if (argIdx < funcSignature.params.length) {
							let paramType = funcSignature.params[argIdx];
							let paramTypeID = getTypeID(paramType);
							let paramSignature = typeSignatures.get(paramType);

							let argTypeID = getTypeID(argType);
							let argSignature = typeSignatures.get(argType);

							if (paramTypeID != "unknown") {
								if (!typesMatch(argType,paramType)) {
									reportUnexpectedType(
										MSG.ERR_CALL_ARG_TYPE,
										"Argument type mismatch",
										argType,
										paramType,
										callExprNode.arguments[argIdx]
									);
								}
								else if (
									paramSignature &&
									!signaturesMatch(argSignature,paramSignature)
								) {
									reportUnexpectedSignature(
										MSG.ERR_CALL_ARG_SIGNATURE,
										"Argument signature mismatch",
										argSignature,paramSignature,
										callExprNode.arguments[argIdx]
									);
								}
							}
							// reverse-register an unknown param type based on a known argument?
							else if (argTypeID != "unknown") {
								let funcParamType = { ...argType, };
								let funcParam = funcNode.params[argIdx];
								let funcParamBinding;

								// simple identifier param?
								if (T.isIdentifier(funcParam)) {
									funcParamBinding = funcNodeScope.getBinding(funcParam.name);
								}
								// simple identifier param with default value?
								else if (
									T.isAssignmentPattern(funcParam) &&
									T.isIdentifier(funcParam.left)
								) {
									funcParamBinding = funcNodeScope.getBinding(funcParam.left.name);
									nodeTypes.set(funcParam.left,funcParamType);
								}

								// did we find a function param binding to imply?
								if (funcParamBinding) {
									funcSignature.params[argIdx] = funcParamType;
									nodeTypes.set(funcParam,funcParamType);

									funcParamBinding = funcNodeScope.getBinding(funcParam.name);
									nodeTypes.set(funcParamBinding,funcParamType);

									if (argSignature) {
										typeSignatures.set(funcParamType,argSignature);
									}

									// NOTE: temporary debugging output
									if (isTaggedType(funcParamType)) {
										addOutputMessage({
											id: MSG.INFO_IMPLY_PARAM_FROM_ARG_TAGGED,
											text: `Implying parameter ${funcParamBinding.identifier.name} from argument, as tagged-type '${argTypeID}'${argSignature ? ` (and registered signature: ${JSON.stringify(argSignature)})` : ""}`,
											node: funcParam,
										});
									}
									else {
										addOutputMessage({
											id: MSG.INFO_IMPLY_PARAM_FROM_ARG_INFERRED,
											text: `Implying parameter ${funcParamBinding.identifier.name} from argument, as inferred-type '${argTypeID}'${argSignature ? ` (and registered signature: ${JSON.stringify(argSignature)})` : ""}`,
											node: funcParam,
										});
									}
								}
							}
						}
						else {
							break;
						}
					}
				}
			}
		}
	}
}

function setScopeBindingType(scope,bindingName,type) {
	var binding = scope.getBinding(bindingName);
	// found a scope binding with no implied type?
	if (
		binding &&
		!nodeTypes.has(binding)
	) {
		nodeTypes.set(binding,{ ...type, });

		// NOTE: temporary debugging output
		let typeID = getTypeID(type);
		if (isTaggedType(type)) {
			addOutputMessage({
				id: MSG.INFO_IMPLY_VAR_TAGGED,
				text: `Implying ${bindingName} as tagged-type '${typeID}'`,
				node: binding.path.node,
			});
		}
		else {
			addOutputMessage({
				id: MSG.INFO_IMPLY_VAR_INFERRED,
				text: `Implying ${bindingName} as inferred-type '${typeID}'`,
				node: binding.path.node,
			});
		}
	}
}

function setScopeBindingSignature(scope,bindingName,signature) {
	var binding = scope.getBinding(bindingName);
	// found a scope binding with no implied type signature?
	if (binding) {
		typeSignatures.set(binding,signature);
	}
}

function getScopeBindingType(scope,bindingName) {
	var binding = scope.getBinding(bindingName);
	if (binding && nodeTypes.has(binding)) {
		return nodeTypes.get(binding);
	}
}

function getScopeBindingSignature(scope,bindingName) {
	var binding = scope.getBinding(bindingName);
	if (binding && typeSignatures.has(binding)) {
		return typeSignatures.get(binding);
	}
}

function binaryExpressionTypes(node) {
	return [
		nodeTypes.has(node.left) ?
			nodeTypes.get(node.left) :
			{ inferred: "unknown", },
		nodeTypes.has(node.right) ?
			nodeTypes.get(node.right) :
			{ inferred: "unknown", },
	];
}

function signaturesMatch(signature1,signature2) {
	if (!(
		signature1 &&
		signature2 &&
		signature1.type &&
		signature2.type &&
		signature1.type == signature2.type
	)) {
		return false;
	}

	if (signature1.type == "func") {
		if (signature1.params.length != signature2.params.length) {
			return false;
		}

		for (let [idx,paramType1] of signature1.params.entries()) {
			let paramType2 = signature2.params[idx];

			if (getTypeID(paramType1) != getTypeID(paramType2)) {
				return false;
			}

			let paramSignature1 = typeSignatures.get(paramType1);
			let paramSignature2 = typeSignatures.get(paramType2);

			if (
				paramSignature1 &&
				!signaturesMatch(paramSignature1,paramSignature2)
			) {
				return false;
			}
		}

		let returnType1 = signature1.return;
		let returnType2 = signature2.return;

		if (getTypeID(returnType1) != getTypeID(returnType2)) {
			return false;
		}
	}

	return true;
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

function addOutputMessage({ type = "info", id = -1, text = "?", } = {}) {
	outputMessages.push({ type, id, text, });
}

function check(code) {
	var ast = babylon.parse(code);
	traverse(ast,collectTypesVisitors);

	for (let msg of outputMessages) {
		if (msg.error) {
			console.error(msg.text);
		}
		else {
			console.log(msg.text);
		}
	}

	return ast;
}
