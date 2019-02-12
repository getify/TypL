"use strict";

var { default: traverse, } = require("@babel/traverse");
var T = require("@babel/types");
var babylon = require("babylon");

var recognizedTypeIDs = [
	"any", "undef", "nul", "string", "bool",
	"number", "finite", "int", "bint", "symb",
	"array", "object", "func", "regex",
];

// store any tagged or inferred types for nodes, or
// implied types for bindings
var nodeTypes = new WeakMap();

// store any type signatures (functions, objects,
// arrays, etc)
var typeSignatures = new WeakMap();

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
			var condType = nodeTypes.get(path.node.test);
			var condTypeID = getTypeID(condType);
			if (
				condTypeID != "bool"
			) {
				reportUnexpectedType("Ternary `?:` expression, unexpected condition type",condTypeID,"bool");
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
				"return": {
					default: true,
					inferred: "undef",
				},
				params: [],
				hasRestParam: false,
			};
			typeSignatures.set(path.node,funcSignature);

			if (T.isIdentifier(path.node.id)) {
				setScopeBindingType(path.scope,path.node.id.name,{ inferred: "func", });
				setScopeBindingSignature(path.scope,path.node.id.name,funcSignature);
			}
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

			console.log(`Function '${getOrInferFunctionName(path)}' signature: ${JSON.stringify(funcSignature)}`);
		},
	},
	ReturnStatement: {
		exit(path) {
			var funcNode = path.getFunctionParent().node;
			var funcSignature = typeSignatures.get(funcNode);

			if (funcSignature) {
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
					// TODO: consolidate error handling
					reportUnexpectedType("Return type mismatched",returnType,funcSignature.returnType);
				}
				// return type signatures mismatched?
				else if (
					functionReturnSignature &&
					returnSignature &&
					!signaturesMatch(returnSignature,functionReturnSignature)
				) {
					reportUnexpectedSignature("Return type signature mismatched",returnSignature,functionReturnSignature);
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
			recognizedTypeIDs.includes(path.node.name) &&
			T.isAssignmentPattern(path.parent)
		) {
			nodeTypes.set(path.node,{ tagged: path.node.name, });
		}
		else if (!T.isFunction(path.parent)) {
			let identifierType = getScopeBindingType(path.scope,path.node.name);
			let identifierSignature = getScopeBindingSignature(path.scope,path.node.name);

			// does identifier's binding have an implied-type from any scope?
			if (identifierType) {
				nodeTypes.set(path.node,{ ...identifierType, });
				typeSignatures.set(path.node,identifierSignature);
			}
			// is there a binding for this specific scope?
			else if (path.scope.bindings && path.node.name in path.scope.bindings) {
				nodeTypes.set(path.node,{ inferred: "undef", });
			}
			// is the `undefined` keyword (identifier) being used?
			//   NOTE: assume no re-assignment of `undefined`
			else if (path.node.name == "undefined") {
				nodeTypes.set(path.node,{ inferred: "undef", });
			}
			// otherwise, it's just plain "unknown" (for now)
			else {
				nodeTypes.set(path.node,{ inferred: "unknown", });
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

			nodeTypes.set(path.node,{ inferred, });
		}
	},
	CallExpression: {
		exit(path) {
			if (T.isIdentifier(path.node.callee)) {
				let calleeName = path.node.callee.name;
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

				if (path.node.callee.name in nativesReturnTypes) {
					nodeTypes.set(path.node,{ inferred: nativesReturnTypes[calleeName], });
				}
				else {
					let funcSignature = getScopeBindingSignature(path.scope,calleeName);
					if (funcSignature) {
						let { default: tmp, ...returnType } = funcSignature.return;
						nodeTypes.set(path.node,{ ...returnType, });

						let funcReturnSignature = typeSignatures.get(funcSignature.return);
						if (funcReturnSignature) {
							typeSignatures.set(path.node,funcReturnSignature);
						}

						// collect argument-types (and signatures) for call-expression
						let callExpressionArguments = [];
						for (let arg of path.node.arguments) {
							let argType = nodeTypes.get(arg);
							if (argType) {
								argType = { ...argType, };
								callExpressionArguments.push(argType);

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
								callExpressionArguments.length > funcSignature.params.length
							) ||
							(
								callExpressionArguments.length < funcSignature.params.length
							)
						) {
							console.error(`Expected ${funcSignature.params.length} arguments, found ${callExpressionArguments.length}`);
						}
						else {
							// compare argument types/signatures to parameter types/signatures
							for (let [argIdx,arg] of callExpressionArguments.entries()) {
								if (argIdx < funcSignature.params.length) {
									let paramType = funcSignature.params[argIdx];
									let paramTypeID = getTypeID(paramType);
									let paramSignature = typeSignatures.get(paramType);

									let argType = arg;
									let argTypeID = getTypeID(argType);
									let argSignature = typeSignatures.get(arg);

									if (paramTypeID != "unknown") {
										if (!typesMatch(argType,paramType)) {
											reportUnexpectedType("Argument type mismatch",argType,paramType);
										}
										else if (
											paramSignature &&
											!signaturesMatch(argSignature,paramSignature)
										) {
											reportUnexpectedSignature("Argument signature mismatch",argSignature,paramSignature);
										}
									}
									// register a param type based on argument?
									else if (argTypeID != "unknown") {
										// TODO?
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
					reportUnexpectedType("Rest element type mismatch",type,"array");
				}
			}
			else {
				console.error("Rest element is an unknown/undeclared variable.");
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
				funcSignature.params.push(paramType);
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

function reportTypeMismatch(label,type1,type2) {
	var type1ID = getTypeID(type1);
	var type2ID = getTypeID(type2);
	console.error(`${label}: type '${type1ID}' doesn't match type '${type2ID}'`);
}

function reportSignatureMismatch(label,signature1,signature2) {
	// TODO: fix this error message
	console.error(`${label}: '${JSON.stringify(signature1)}' doesn't match '${JSON.stringify(signature2)}`);
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
	else if (foundID == "unknown") {
		console.error(`${label}: type could not be determined`);
	}
	else {
		console.error(`${label}: found type '${foundID}'`);
	}
}

function reportUnexpectedSignature(label,foundSignature,expectedSignature) {
	// TODO: fix this error message
	console.error(`${label}: expected signature ${JSON.stringify(expectedSignature)}, but found signature ${JSON.stringify(foundSignature)}`);
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
			reportTypeMismatch("Binary `+` operation, mixed operand types",rightType,leftType);
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

	nodeTypes.set(exprNode,{ inferred: "bool", });

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
			reportTypeMismatch(`Binary \`${op}\` operation, mixed operand types`,rightTypeID,leftTypeID);
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

	nodeTypes.set(exprNode,{ inferred: "bool", });

	if (["==","!="].includes(op)) {
		if (!(
			typesMatch(leftTypeID,rightTypeID) ||
			(
				isNumberOrSubtype(leftTypeID) &&
				isNumberOrSubtype(rightTypeID)
			)
		)) {
			reportTypeMismatch(`Binary \`${op}\` operation, mixed operand types`,rightTypeID,leftTypeID);
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
				reportTypeMismatch(`Binary \`${op}\` operation, mixed operand types`,rightTypeID,leftTypeID);
			}
		}
	}
}

function handleAssignmentExpressionType(scope,exprNode,targetNode,sourceNode) {
  // console.log("handleAssignmentExpressionType")
	// target is simple identifier?
	if (T.isIdentifier(targetNode)) {
		let targetBinding = scope.getBinding(targetNode.name);
    
		if (targetBinding) {
			let targetType = nodeTypes.get(targetBinding);
			let targetSignature = typeSignatures.get(targetBinding);
			let sourceType = nodeTypes.get(sourceNode);
			let sourceSignature = typeSignatures.get(sourceNode);
      
      
			// source expression has a recognized type?
			if (sourceType && getTypeID(sourceType) != "unknown") {
				if (exprNode) {
					nodeTypes.set(exprNode,{ ...sourceType, });
				}
				// target already has an implied type?
				if (targetType) {
					if (!typesMatch(targetType,sourceType)) {
            if(getTypeID(targetType) == "undef"){
              nodeTypes.set(targetBinding, sourceType)
            }
						reportUnexpectedType("Assignment type mismatch",targetType,sourceType);
					}
					else if (targetSignature) {
						if (!signaturesMatch(sourceSignature,targetSignature)) {
							reportUnexpectedSignature("Assignment signature mismatch",sourceSignature,targetSignature);
						}
					}
				}
				else {
					nodeTypes.set(targetNode,{ ...sourceType, });
					setScopeBindingType(scope,targetNode.name,sourceType);
				}

				// need to copy the reference to the type signature?
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
			console.error("Assigning to an unknown/undeclared variable.");
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
			console.log(`Implying ${bindingName} with tagged-type '${typeID}'`);
		}
		else {
			console.log(`Implying ${bindingName} to inferred-type '${typeID}'`);
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

function check(code) {
	var ast = babylon.parse(code);
	traverse(ast,collectTypesVisitors);
	return ast;
}
