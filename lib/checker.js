"use strict";

var path = require("path");

global.RUNTIME = require(path.join(__dirname,"runtime.js"));

var { default: traverse, } = require("@babel/traverse");
var T = require("@babel/types");
var babylon = require("babylon");

const PASS_LIMIT = 10;

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
	ERR_CALL_ARG_COUNT: 113,
	ERR_CALL_ARG_COUNT_UNVERIFIABLE: 114,
	ERR_CALL_ARG_SPREAD_TYPE: 115,
	ERR_CALL_ARG_TYPE: 116,
	ERR_CALL_ARG_SIGNATURE: 117,
	ERR_CALL_NO_SIGNATURE: 118,
	ERR_BINARY_PLUS_MIXED_TYPES: 119,
	ERR_RELATIVE_OP_MIXED_TYPES: 120,
	ERR_RELATIVE_OP_BOTH_TYPES: 121,
	ERR_RELATIVE_OP_TYPE: 122,
	ERR_LOOSE_EQUALITY_UNKNOWN_TYPE: 123,
	ERR_LOOSE_EQUALITY_MIXED_TYPES: 124,
	ERR_STRICT_EQUALITY_KNOWN_MIXED_TYPES: 125,
	ERR_STRICT_EQUALITY_KNOWN_MATCHING_TYPES: 126,
	ERR_UNARY_NUMERIC_OP_TYPE: 127,
	ERR_MODULUS_OP_BOTH_TYPES: 128,
	ERR_MODULUS_OP_TYPE: 129,
	ERR_BINARY_NUMERIC_OP_TYPE: 130,
	ERR_FUNC_RETURN_TYPE: 131,
	ERR_FUNC_RETURN_SIGNATURE: 132,
	ERR_TERNARY_COND_TYPE: 133,
	ERR_SPREAD_UNKNOWN_TYPE: 134,
	ERR_SPREAD_TYPE: 135,
	ERR_LOGICAL_COND_TYPE: 136,
	ERR_IN_OP_TYPE: 137,
	ERR_INSTANCEOF_OP_TYPE: 138,
	ERR_IF_CONDITIONAL: 139,
	ERR_WHILE_CONDITIONAL: 140,
	ERR_DO_WHILE_CONDITIONAL: 141,
	ERR_TAGGED_LITERAL_TYPE: 142,
	ERR_TAGGED_INVALID_LITERAL: 143,
	ERR_TAGGED_EXPR_TYPE: 144,
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

// track unknowns for multi-pass
var markedUnknowns = new Set();
var markedKnowns = new Set();


var collectTypesVisitors = {
	TaggedTemplateExpression: {
		exit(path) {
			// is this a recognized type-tag?
			if (
				T.isIdentifier(path.node.tag) &&
				recognizedTypeIDs.includes(path.node.tag.name) &&
				T.isTemplateLiteral(path.node.quasi)
			) {
				// type-tag attached to single literal (ie, int`42`)?
				if (path.node.quasi.quasis.length == 1) {
					try {
						Function(`RUNTIME.${path.node.tag.name}\`${path.node.quasi.quasis[0].value.raw}\`;`)();
					}
					catch (err) {
						addOutputMessage({
							id: MSG.ERR_TAGGED_LITERAL_TYPE,
							type: "error",
							text: `Type-Tag: expected type '${path.node.tag.name}'; ${err.toString()}`,
							node: path.node.quasi.quasis[0],
						});
					}
				}
				// type-tag attached to single-expression literal (ie, int`${x}`)
				else if (
					path.node.quasi.expressions.length == 1 &&
					T.isTemplateElement(path.node.quasi.quasis[0]) &&
					T.isTemplateElement(path.node.quasi.quasis[1]) &&
					(
						// ...and surrounding literal strings are trivial/empty
						(
							path.node.quasi.quasis[0].value.cooked.trim() == "" &&
							path.node.quasi.quasis[1].value.cooked.trim() == ""
						) ||
						// ...or type-tag of 'string' (so we can still validate
						// its expression type)
						path.node.tag.name == "string"
					)
				) {
					let exprType = nodeTypes.get(path.node.quasi.expressions[0]);

					if (!isAssignmentAllowed(exprType,path.node.tag.name)) {
						reportUnexpectedType(
							MSG.ERR_TAGGED_EXPR_TYPE,
							"Type-Tag expression, unexpected type",
							exprType,
							path.node.tag.name,
							path.node.quasi.expressions[0]
						);
					}
				}
				// not one of the type-tags which allow more than a single input?
				else if ( ![ "any", "string", "regex", ].includes(path.node.tag.name)) {
					addOutputMessage({
						id: MSG.ERR_TAGGED_INVALID_LITERAL,
						type: "error",
						text: "Type-Tag, invalid input",
						node: path.node.quasi,
					});
				}
			}
			else {
				// TODO: add handling of tagged-literal as call-expression (#32)
			}
		},
	},
	TemplateLiteral(path) {
		if (!T.isTaggedTemplateExpression(path.parent)) {
			markNodeType(path.node,{ inferred: "string", });
		}
	},
	VariableDeclarator: {
		exit(path) {
			// does the declarator have an init expression?
			if (path.node.init) {
				handleAssignmentExpressionType(path.scope,path.node,path.node.id,path.node.init);
			}
			// declaration without an init, like `var x;`
			else {
				// was this identifier binding previously marked "unknown"?
				let binding = path.scope.getBinding(path.node.id.name);
				if (markedUnknowns.has(binding)) {
					// mark as "known" (to be `undef`)
					markedKnowns.add(binding);
				}

				markScopeBindingType(path.scope,path.node.id.name,{ inferred: "undef", });
			}
		},
	},
	IfStatement: {
		exit(path) {
			verifyBooleanConditional(
				MSG.ERR_IF_CONDITIONAL,
				"If-statement conditional, unexpected type",
				path.node.test
			);
		},
	},
	WhileStatement: {
		exit(path) {
			verifyBooleanConditional(
				MSG.ERR_WHILE_CONDITIONAL,
				"While-loop conditional, unexpected type",
				path.node.test
			);
		},
	},
	DoWhileStatement: {
		exit(path) {
			verifyBooleanConditional(
				MSG.ERR_DO_WHILE_CONDITIONAL,
				"Do..While-loop conditional, unexpected type",
				path.node.test
			);
		},
	},
	// default = value assignment (param, destructuring)
	AssignmentPattern: {
		exit(path) {
			// NOTE: we skip the left-hand side identifier of
			// assignment expressions
			//
			// was this identifier's assignment not (yet) typed?
			if (
				T.isIdentifier(path.node.left) &&
				!nodeTypes.has(path.node.right)
			) {
				// flag as needing multi-pass resolution for this identifier
				let binding = path.scope.getBinding(path.node.left.name);
				if (binding) {
					markedUnknowns.add(binding);
				}
			}

			handleAssignmentExpressionType(path.scope,path.node,path.node.left,path.node.right,/*isAssignmentPattern=*/true);
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
					markNodeType(path.node,{ ...lastExprType, });
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
			markNodeType(path.node,{ inferred: "object", });
		},
	},
	UnaryExpression: {
		exit(path) {
			if (path.node.operator == "void") {
				markNodeType(path.node,{ inferred: "undef", });
			}
			else if (path.node.operator == "typeof") {
				markNodeType(path.node,{ inferred: "string", });
			}
			else if (path.node.operator == "~") {
				handleUnaryNumeric(path.node.operator,path.node);
			}
			// numeric coercion operators
			else if ([ "+", "-", ].includes(path.node.operator)) {
				markNodeType(path.node,{ inferred: "number", });
			}
			// boolean coercion operators
			else if ([ "!", "delete", ].includes(path.node.operator)) {
				markNodeType(path.node,{ inferred: "bool", });
			}
		},
	},
	BinaryExpression: {
		exit(path) {
			// binary numeric plus?
			if (path.node.operator == "+") {
				handleBinaryPlus(path.node);
			}
			else if (path.node.operator == "in") {
				markNodeType(path.node,{ inferred: "bool", });

				let leftTypeID = getTypeID(nodeTypes.get(path.node.left));
				let rightTypeID = getTypeID(nodeTypes.get(path.node.right));
				if (![ "string", "number", "symb", ].includes(leftTypeID)) {
					reportUnexpectedType(
						MSG.ERR_IN_OP_TYPE,
						"`in` operation, unexpected operand type",
						leftTypeID,
						"object",
						path.node.left
					);
				}
				if (rightTypeID != "object") {
					reportUnexpectedType(
						MSG.ERR_IN_OP_TYPE,
						"`in` operation, unexpected operand type",
						rightTypeID,
						"object",
						path.node.right
					);
				}
			}
			else if (path.node.operator == "instanceof") {
				markNodeType(path.node,{ inferred: "bool", });

				let leftTypeID = getTypeID(nodeTypes.get(path.node.left));
				let rightTypeID = getTypeID(nodeTypes.get(path.node.right));
				if (leftTypeID != "object") {
					reportUnexpectedType(
						MSG.ERR_INSTANCEOF_OP_TYPE,
						"`instanceof` operation, unexpected operand type",
						leftTypeID,
						"object",
						path.node.left
					);
				}
				if (getTypeID(nodeTypes.get(path.node.right)) != "func") {
					reportUnexpectedType(
						MSG.ERR_INSTANCEOF_OP_TYPE,
						"`instanceof` operation, unexpected operand type",
						rightTypeID,
						"func",
						path.node.right
					);
				}
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
			// verify the left-hand expression is boolean type
			verifyBooleanConditional(
				MSG.ERR_LOGICAL_COND_TYPE,
				`Logical \`${path.node.op}\` expression, unexpected condition (left side) type`,
				path.node.left
			);

			// select the type from left/right side expressions
			handleBinarySelection(path.node,path.node.left,path.node.right);
		},
	},
	ConditionalExpression: {
		exit(path) {
			// verify the test condition is boolean type
			verifyBooleanConditional(
				MSG.ERR_TERNARY_COND_TYPE,
				"Ternary `?:` expression, unexpected condition type",
				path.node.test
			);

			// select the type from the then/else clauses
			handleBinarySelection(path.node,path.node.consequent,path.node.alternate);
		},
	},
	Function: {
		enter(path) {
			markNodeType(path.node,{ inferred: "func", });

			// setup default type signature for function
			if (!typeSignatures.has(path.node)) {
				let funcSignature = {
					type: "func",
					params: [],
					hasRestParam: false,
					"return": {
						default: true,
						inferred: "undef",
					},
				};
				markTypeSignature(path.node,funcSignature);
				signatureNodePaths.set(funcSignature,path);
			}
			else {
				let funcSignature = typeSignatures.get(path.node);
				if (
					getTypeID(funcSignature.return) == "undef" &&
					!funcSignature.return.explicit
				) {
					funcSignature.return.default = true;
				}
			}
		},
		exit(path) {
			var funcSignature = typeSignatures.get(path.node);

			// exiting an arrow function with expression body?
			if (
				T.isArrowFunctionExpression(path.node) &&
				T.isExpression(path.node.body)
			) {
				if (funcSignature.return.default === true) {
					delete funcSignature.return.default;
					delete funcSignature.return.inferred;
				}

				let returnType;
				if (nodeTypes.has(path.node.body)) {
					returnType = nodeTypes.get(path.node.body);
				}
				else {
					returnType = { inferred: "unknown", };
				}
				Object.assign(funcSignature.return,returnType);

				let returnSignature = typeSignatures.get(path.node.body);
				markTypeSignature(funcSignature.return,returnSignature,/*forceOverride=*/true);
			}
			// NOTE: otherwise, regular function with body
			// did we *not* encounter a `return` statement in the body?
			else if (!funcSignature.return.explicit) {
				// finalize the default-return as if a `return;` had been
				// encountered
				delete funcSignature.return.default;
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
				// NOT a PTC self-recursive return (which we will
				//   skip func-signature registration for)?
				if (!(
					path.node.argument &&
					T.isCallExpression(path.node.argument) &&
					T.isIdentifier(path.node.argument.callee) &&
					funcSignature == getScopeBindingSignature(path.scope,path.node.argument.callee.name)
				)) {
					funcSignature.return.explicit = true;

					let returnType;
					if (path.node.argument) {
						if (nodeTypes.has(path.node.argument)) {
							returnType = nodeTypes.get(path.node.argument);
							markedKnowns.add(funcSignature.return);
						}
						else {
							returnType = { inferred: "unknown", };
						}
					}
					else {
						returnType = { inferred: "undef", };
						markedKnowns.add(funcSignature.return);
					}
					let functionReturnSignature = typeSignatures.get(funcSignature.return);
					let returnSignature = typeSignatures.get(path.node.argument);

					if (returnSignature) {
						markedKnowns.add(funcSignature.return);
					}

					// first encountered `return` in the function?
					if (funcSignature.return.default === true) {
						// ...and not an 'unknown' type?
						if (getTypeID(returnType) != "unknown") {
							delete funcSignature.return.default;
							delete funcSignature.return.inferred;
							Object.assign(funcSignature.return,returnType);

							markTypeSignature(funcSignature.return,returnSignature,/*forceOverride=*/true);
						}
					}
					// return types mismatched?
					//
					// NOTE: using `isAssignmentAllowed(..)` here because
					// conceptually return expressions are "assigned" to
					// the return value
					else if (!isAssignmentAllowed(returnType,funcSignature.return)) {
						reportUnexpectedType(
							MSG.ERR_FUNC_RETURN_TYPE,
							"Return type mismatched",
							returnType,
							funcSignature.return,
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
		// identifier is one of the recognized type IDs?
		if (recognizedTypeIDs.includes(path.node.name)) {
			// a type-tag (ie, int`42`)?
			if (
				T.isTaggedTemplateExpression(path.parent) &&
				path.node == path.parent.tag
			) {
				markNodeType(path.parent,{ tagged: path.node.name, });
			}
			// type ID as default value in Assignment Pattern (i.e., `= int`)?
			//   function foo(a = int) { .. }
			//   [ a = int ] = ..
			//   { a: A = int } = ..
			else if (
				T.isAssignmentPattern(path.parent) &&
				path.node == path.parent.right
			) {
				// NOTE: this assignment-pattern will be compiled away most likely
				markNodeType(path.node,{ tagged: path.node.name, });
			}
			else {
				// NOTE: type tags are just functions
				markNodeType(path.node,{ inferred: "func", });
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
				markNodeType(path.node,{ ...identifierType, });
				markTypeSignature(path.node,identifierSignature);
			}
			// is the `undefined` keyword (identifier) being used?
			// NOTE: assume no re-assignment of `undefined`
			else if (path.node.name == "undefined") {
				markNodeType(path.node,{ inferred: "undef", });
			}
			// are the `NaN` / `Infinity` keywords (identifiers) being used?
			else if ([ "NaN", "Infinity", ].includes(path.node.name)) {
				markNodeType(path.node,{ inferred: "number", });
			}
			// NOTE: no type (yet), and not `undefined` literal
			else if (
				// not a local binding?
				!(
					path.scope.bindings &&
					path.node.name in path.scope.bindings &&
					path.scope.bindings[path.node.name].kind != "param"
				) &&
				// not the `key` of an object-property which holds
				// an assignment-pattern?
				!(
					T.isObjectProperty(path.parent) &&
					path.parent.key == path.node &&
					T.isAssignmentPattern(path.parent.value)
				) &&
				// not on the left-hand side of an assignment-pattern?
				!(
					T.isAssignmentPattern(path.parent) &&
					path.parent.left == path.node
				)
			) {
				// flag as needing multi-pass resolution for this identifier
				let binding = path.scope.getBinding(path.node.name);
				if (binding) {
					markedUnknowns.add(binding);
				}
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
			markNodeType(path.node,{ inferred: "array", });
		},
	},
	ArrayPattern: {
		exit(path) {
			markNodeType(path.node,{ inferred: "array", });
		},
	},
	ObjectExpression: {
		exit(path) {
			markNodeType(path.node,{ inferred: "object", });
		},
	},
	ObjectPattern: {
		exit(path) {
			markNodeType(path.node,{ inferred: "object", });
		},
	},
	NullLiteral: {
		exit(path) {
			markNodeType(path.node,{ inferred: "nul", });
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

			if (inferred == "number") {
				let v = Number(path.node.value);
				if (Number.isSafeInteger(v)) {
					inferred = "int";
				}
				else if (Number.isFinite(v)) {
					inferred = "finite";
				}
			}

			if (inferred != "unknown") {
				markNodeType(path.node,{ inferred, });
			}
		}
	},
	CallExpression: {
		exit(path) {
			var isSelfRecursivePTC = false;

			// is the call-expression a PTC (in a return)?
			if (
				(
					T.isReturnStatement(path.parent) &&
					path.parent.argument == path.node
				) ||
				(
					T.isArrowFunctionExpression(path.parent) &&
					path.parent.body == path.node
				)
			) {
				let funcNode = path.getFunctionParent().node;
				let funcSignature = typeSignatures.get(funcNode);

				// is the PTC self-recursive?
				isSelfRecursivePTC = (
					T.isIdentifier(path.node.callee) &&
					funcSignature == getScopeBindingSignature(path.scope,path.node.callee.name)
				);
			}

			handleCallExpression(path.scope,path.node,isSelfRecursivePTC);
		},
	},
	SpreadElement: {
		exit(path) {
			var expectedTypeID =
				// spreading into an array or function call?
				(
					T.isArrayExpression(path.parent) ||
					T.isCallExpression(path.parent)
				) ? "array" :
				// spreading into an object literal?
				T.isObjectExpression(path.parent) ? "object" :
				// should never get here
				"unknown";

			if (expectedTypeID != "unknown") {
				let foundTypeID = "unknown";

				if (T.isCallExpression(path.node.argument)) {
					let funcSignature = typeSignatures.get(path.node.argument);
					if (funcSignature) {
						foundTypeID = getTypeID(funcSignature.return);
					}
				}
				else {
					foundTypeID = getTypeID(nodeTypes.get(path.node.argument));
				}

				// spread types
				if (foundTypeID == "unknown") {
					reportUnexpectedType(
						MSG.ERR_SPREAD_UNKNOWN_TYPE,
						"Spread element type mismatch",
						foundTypeID,
						expectedTypeID,
						path.node.argument
					);
				}
				else {
					reportUnexpectedType(
						MSG.ERR_SPREAD_TYPE,
						"Spread element type mismatch",
						foundTypeID,
						expectedTypeID,
						path.node.argument
					);
				}
			}
		},
	},
	RestElement: {
		exit(path) {
			// NOTE: rest elements can only be identifiers, not member expressions
			markNodeType(path.node,{ inferred: "array", isRest: true, });
			var binding = path.scope.getBinding(path.node.argument.name);

			if (binding) {
				let type = nodeTypes.get(binding);
				if (getTypeID(type) == "unknown") {
					markScopeBindingType(path.scope,path.node.argument.name,{ inferred: "array", });
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
					text: "Rest element references unknown/undeclared variable",
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

	for (let [paramIdx,param] of funcNode.params.entries()) {
		let paramType = nodeTypes.get(param);
		if (paramType) {
			// don't save a ...rest element into the signature,
			// but flag its presence (for signature checking)
			if (paramType.isRest) {
				funcSignature.hasRestParam = true;
				break;
			}
			else {
				if (!funcSignature.params[paramIdx]) {
					paramType = { ...paramType, };
					funcSignature.params[paramIdx] = paramType;
				}
				else if (!typesMatch(funcSignature.params[paramIdx],paramType)) {
					let prevType = funcSignature.params[paramIdx];
					delete prevType.inferred;
					Object.assign(prevType,paramType);
					paramType = prevType;
				}
				else {
					paramType = funcSignature.params[paramIdx];
				}

				// need to register a param's signature?
				let paramSignature = typeSignatures.get(param);
				markTypeSignature(paramType,paramSignature);
			}
		}
		else if (!funcSignature.params[paramIdx]) {
			let funcParamName;

			// simple identifier param?
			if (T.isIdentifier(param)) {
				funcParamName = param.name;
			}
			// simple identifier param with default value?
			else if (
				T.isAssignmentPattern(param) &&
				T.isIdentifier(param.left)
			) {
				funcParamName = param.left.name;
			}

			let funcParamBinding = funcParamName ?
				path.scope.getBinding(funcParamName) :
				undefined;

			// flag as needing multi-pass resolution for this parameter
			if (funcParamBinding) {
				markedUnknowns.add(funcParamBinding);
			}

			funcSignature.params[paramIdx] = { inferred: "unknown", };
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

function verifyBooleanConditional(errID,errMsg,node) {
	var condTypeID = getTypeID(nodeTypes.get(node));

	if (condTypeID != "bool") {
		reportUnexpectedType(
			errID,
			errMsg,
			condTypeID,
			"bool",
			node
		);
	}
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
			markNodeType(exprNode,{ tagged: leftTypeID, });
		}
		else {
			markNodeType(exprNode,{ inferred: leftTypeID, });
		}
	}
	else {
		// TODO: union type?
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
				markNodeType(exprNode,{ tagged: "string", });
			}
			else {
				markNodeType(exprNode,{ inferred: "string", });
			}
		}
		else {
			markNodeType(exprNode,{ inferred: "string", });
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

	if ([ "++", "--", ].includes(op)) {
		if (argType) {
			if (isNumberOrSubtype(argTypeID)) {
				markNodeType(exprNode,{ ...argType, });
			}
			else {
				markNodeType(exprNode,{ inferred: "number", });
			}
		}
	}
	else {
		markNodeType(exprNode,{ inferred: "number", });
	}

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
			markNodeType(exprNode,{ tagged: "bint", });
		}
		else {
			markNodeType(exprNode,{ inferred: "bint", });
		}
	}
	else if (op == "%") {
		if (
			leftTypeID == "int" &&
			leftTypeID == rightTypeID &&
			isTaggedType(leftType) &&
			isTaggedType(rightType)
		) {
			markNodeType(exprNode,{ tagged: "int", });
		}
		else {
			markNodeType(exprNode,{ inferred: "int", });

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
			markNodeType(exprNode,{ tagged: "number", });
		}
		else {
			markNodeType(exprNode,{ inferred: "number", });
		}
	}
	else {
		markNodeType(exprNode,{ inferred: "number", });
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

	markNodeType(exprNode,{ inferred: "bool", });

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
			leftTypeID == "string" ||
			rightTypeID == "string"
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

	markNodeType(exprNode,{ inferred: "bool", });

	if ([ "==", "!=", ].includes(op)) {
		if (
			leftTypeID == "unknown" &&
			rightTypeID == "unknown"
		) {
			addOutputMessage({
				id: MSG.ERR_LOOSE_EQUALITY_UNKNOWN_TYPE,
				type: "error",
				text: `Coercive Equality \`${op}\` operation, unknown operand types`,
				node: exprNode,
			});
		}
		else if (leftTypeID == "unknown") {
			addOutputMessage({
				id: MSG.ERR_LOOSE_EQUALITY_UNKNOWN_TYPE,
				type: "error",
				text: `Coercive Equality \`${op}\` operation, unknown operand type`,
				node: exprNode.left,
			});
		}
		else if (rightTypeID == "unknown") {
			addOutputMessage({
				id: MSG.ERR_LOOSE_EQUALITY_UNKNOWN_TYPE,
				type: "error",
				text: `Coercive Equality \`${op}\` operation, unknown operand type`,
				node: exprNode.right,
			});
		}
		else if (!(
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
	else if ([ "===", "!==", ].includes(op)) {
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
					MSG.ERR_STRICT_EQUALITY_KNOWN_MIXED_TYPES,
					`Strict equality \`${op}\`, known mixed operand types`,
					rightTypeID,
					leftTypeID,
					exprNode
				);
			}
		}
	}
}

function handleAssignmentExpressionType(scope,exprNode,targetNode,sourceNode,isAssignmentPattern = false) {
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
			if (sourceType && sourceTypeID != "unknown") {
				if (exprNode) {
					markNodeType(exprNode,{ ...sourceType, });
				}
				// target already has an implied type?
				if (targetType) {
					if (!isAssignmentAllowed(sourceType,targetType)) {
						if (targetType.inferred == "undef") {
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
								sourceNode
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
								sourceNode
							);
						}
					}
				}
				else {
					markNodeType(targetNode,{ ...sourceType, });
					markScopeBindingType(scope,targetNode.name,sourceType);

					markedKnowns.add(targetBinding);
				}

				// need to copy a reference to the type signature?
				if (
					!targetSignature &&
					sourceSignature
				) {
					markedKnowns.add(targetBinding);

					markTypeSignature(targetBinding,sourceSignature);
					if (exprNode) {
						markTypeSignature(exprNode,sourceSignature);
					}
				}
			}
			else if (!targetType) {
				// flag as needing multi-pass resolution for this identifier
				markedUnknowns.add(targetBinding);
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
				markNodeType(exprNode,{ ...sourceType });
			}
			else {
				markNodeType(exprNode,{ inferred: "array", });
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
					handleAssignmentExpressionType(scope,null,targetElem,sourceElem,isAssignmentPattern);
				}
			}
		}
	}
	// target is object destructuring pattern?
	else if (T.isObjectPattern(targetNode)) {
		if (exprNode) {
			let sourceType = nodeTypes.get(sourceNode);
			if (sourceType) {
				markNodeType(exprNode,{ ...sourceType });
			}
			else {
				markNodeType(exprNode,{ inferred: "object", });
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
					handleAssignmentExpressionType(scope,null,targetProp,sourceProp.value,isAssignmentPattern);
				}
			}
		}
	}
}

function handleCallExpression(scope,callExprNode,isSelfRecursivePTC = false) {
	var calleeName;
	var funcSignature;

	// simple identifier function call?
	if (T.isIdentifier(callExprNode.callee)) {
		calleeName = callExprNode.callee.name;

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
			let nativeFn = new Function(`return ${calleeName};`)();
			if (typeSignatures.has(nativeFn)) {
				funcSignature = typeSignatures.get(nativeFn);
			}
			else {
				// setup default signature for natives
				funcSignature = {
					type: "func",
					params: [ { tagged: "any", }, ],
					hasRestParam: false,
					"return": {
						inferred: nativesReturnTypes[calleeName],
					},
				};
				typeSignatures.set(nativeFn,funcSignature);
			}

			markNodeType(callExprNode,{ inferred: nativesReturnTypes[calleeName], });
		}
		else {
			funcSignature = getScopeBindingSignature(scope,calleeName);
		}
	}
	// IIFE?
	else if (T.isFunctionExpression(callExprNode.callee)) {
		// NOTE: no need for `calleeName` to be set/inferred, since
		// we definitely have a signature for an IIFE's function
		funcSignature = typeSignatures.get(callExprNode.callee);
	}

	// did we find a function signature to check the call-expression against?
	if (funcSignature) {
		let returnType;

		// no return found in function?
		if (funcSignature.return.default === true) {
			returnType = { inferred: "unknown", };
		}
		else {
			let tmp;
			({ default: tmp, ...returnType } = funcSignature.return);
			markNodeType(callExprNode,{ ...returnType, });
		}

		if (getTypeID(returnType) != "unknown") {
			let funcReturnSignature = typeSignatures.get(funcSignature.return);
			markTypeSignature(callExprNode,funcReturnSignature);
		}
		// NOTE: self-recursive PTC will never answer the return-type
		// of a function
		else if (!isSelfRecursivePTC) {
			// flag as needing multi-pass resolution for this call
			// expressions's result
			markedUnknowns.add(funcSignature.return);
		}

		// collect argument-types (and signatures) for call-expression
		let countVerifiable = true;
		let callExpressionArgumentTypes = [];
		for (let arg of callExprNode.arguments) {
			if (T.isSpreadElement(arg)) {
				countVerifiable = false;
			}
			let argType = nodeTypes.get(arg);
			if (argType) {
				argType = { ...argType, };
				callExpressionArgumentTypes.push(argType);

				// does the argument itself (object, array,
				// call-expression) have a signature?
				let argSignature = typeSignatures.get(arg);
				markTypeSignature(argType,argSignature);
			}
			else {
				callExpressionArgumentTypes.push({ inferred: "unknown", });
			}
		}

		// check count of arguments vs parameters
		if (
			(
				!funcSignature.hasRestParam &&
				callExpressionArgumentTypes.length > funcSignature.params.length
			) ||
			(
				callExpressionArgumentTypes.length < funcSignature.params.length
			)
		) {
			if (countVerifiable) {
				addOutputMessage({
					id: MSG.ERR_CALL_ARG_COUNT,
					type: "error",
					text: `Expected ${funcSignature.params.length} arguments, found ${callExpressionArgumentTypes.length}`,
					node: callExprNode,
				});
			}
			else {
				addOutputMessage({
					id: MSG.ERR_CALL_ARG_COUNT_UNVERIFIABLE,
					type: "error",
					text: `Expected ${funcSignature.params.length} arguments, could not verify count because of a \`...\` spread`,
					node: callExprNode,
				});
			}
		}

		// compare argument types/signatures to parameter types/signatures
		let funcNodePath = signatureNodePaths.get(funcSignature);
		let funcNodeScope = funcNodePath ? funcNodePath.scope : undefined;
		let funcNode = funcNodePath ? funcNodePath.node : undefined;
		for (let [argIdx,argType] of callExpressionArgumentTypes.entries()) {
			// did we hit a spread argument?
			if (T.isSpreadElement(callExprNode.arguments[argIdx])) {
				// stop comparing arguments/params because of spread
				addOutputMessage({
					id: MSG.ERR_CALL_ARG_SPREAD_TYPE,
					type: "error",
					text: "Not all arguments could be verified because of a `...` spread",
					node: callExprNode,
				});

				break;
			}

			// does this argument have a param to compare to?
			if (argIdx < funcSignature.params.length) {
				let paramType = funcSignature.params[argIdx];
				let paramTypeID = getTypeID(paramType);
				let paramSignature = typeSignatures.get(paramType);

				let argTypeID = getTypeID(argType);
				let argSignature = typeSignatures.get(argType);

				if (paramTypeID != "unknown") {
					// NOTE: using `isAssignmentAllowed(..)` here because
					// conceptually arguments are "assigned" to parameters
					if (!isAssignmentAllowed(argType,paramType)) {
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
							argSignature,
							paramSignature,
							callExprNode.arguments[argIdx]
						);
					}
				}
				// reverse-register an unknown param type based on a known argument type?
				else if (
					funcNode &&
					argTypeID != "unknown"
				) {
					let funcParamType = { ...argType, };
					let funcParam = funcNode.params[argIdx];
					let funcParamName;

					// simple identifier param?
					if (T.isIdentifier(funcParam)) {
						funcParamName = funcParam.name;
					}
					// simple identifier param with default value?
					else if (
						T.isAssignmentPattern(funcParam) &&
						T.isIdentifier(funcParam.left)
					) {
						funcParamName = funcParam.left.name;
						markNodeType(funcParam.left,funcParamType);
					}

					let funcParamBinding = funcParamName ?
						funcNodeScope.getBinding(funcParamName) :
						undefined;

					// did we find a function param binding to imply?
					if (funcParamBinding) {
						funcSignature.params[argIdx] = funcParamType;
						markNodeType(funcParam,funcParamType);
						markNodeType(funcParamBinding,funcParamType);

						markedKnowns.add(funcParamBinding);

						if (argSignature) {
							markTypeSignature(funcParamType,argSignature);
							markTypeSignature(funcParamBinding,argSignature);
						}

						// NOTE: temporary debugging output
						if (isTaggedType(funcParamType)) {
							addOutputMessage({
								id: MSG.INFO_IMPLY_PARAM_FROM_ARG_TAGGED,
								text: `Implying parameter ${funcParamName} from argument, as tagged-type '${argTypeID}'${argSignature ? ` (and registered signature: ${JSON.stringify(argSignature)})` : ""}`,
								node: funcParam,
							});
						}
						else {
							addOutputMessage({
								id: MSG.INFO_IMPLY_PARAM_FROM_ARG_INFERRED,
								text: `Implying parameter ${funcParamName} from argument, as inferred-type '${argTypeID}'${argSignature ? ` (and registered signature: ${JSON.stringify(argSignature)})` : ""}`,
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
	else {
		addOutputMessage({
			id: MSG.ERR_CALL_NO_SIGNATURE,
			type: "error",
			text: `Could not find signature to check function call '${calleeName}(..)'`,
			node: callExprNode,
		});

		// flag as needing multi-pass resolution for this function
		// signature
		let binding = scope.getBinding(calleeName);
		if (binding) {
			markedUnknowns.add(binding);
		}
	}
}

function markScopeBindingType(scope,bindingName,type) {
	var binding = scope.getBinding(bindingName);
	// found a scope binding with no implied type?
	if (
		binding &&
		!nodeTypes.has(binding)
	) {
		markNodeType(binding,{ ...type, });

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

function markScopeBindingSignature(scope,bindingName,signature) {
	var binding = scope.getBinding(bindingName);
	// found a scope binding with no implied type signature?
	if (binding) {
		markTypeSignature(binding,signature);
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

function isAssignmentAllowed(sourceType,targetType) {
	if (typesMatch(sourceType,targetType)) {
		return true;
	}

	let matches = {
		any: recognizedTypeIDs,
		int: [ "int", ],
		number: [ "number", "int", "finite", ],
		finite: [ "finite", "int", ],
		bint: [ "bint", "int", ],
		string: [ "string", ]
	}

	let sourceTypeID = getTypeID(sourceType)
	let targetTypeID = getTypeID(targetType)

	return (
		matches[targetTypeID] &&
		matches[targetTypeID].includes(sourceTypeID)
	)
}

function isNumberOrSubtype(type) {
	var typeID = getTypeID(type);
	return (typeID == "number" || isFiniteOrSubtype(typeID));
}

function isFiniteOrSubtype(type) {
	var typeID = getTypeID(type);
	return [ "finite", "int", "bint", ].includes(typeID);
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

function markNodeType(node,type,forceOverride = false) {
	let prevType = nodeTypes.get(node);
	if (
		type &&
		(
			forceOverride ||
			getTypeID(prevType) == "unknown"
		)
	) {
		nodeTypes.set(node,type);
	}
}

function markTypeSignature(node,signature,forceOverride = false) {
	if (
		signature &&
		(
			forceOverride ||
			!typeSignatures.has(node)
		)
	) {
		typeSignatures.set(node,signature);
	}
}

function addOutputMessage({ type = "info", id = -1, text = "?",  node = {}, } = {}) {
	let textWithLoc = node.loc ? `${text}, at line ${node.loc.start.line}, column ${node.loc.start.column}` : text;
	outputMessages.push({ type, id, text: textWithLoc, });
}

function check(code) {
	var ast = babylon.parse(code);

	multipass: for (let passCount = 1; passCount <= PASS_LIMIT; passCount++) {
		markedKnowns.clear();
		markedUnknowns.clear();

		let prevMsgs = outputMessages.filter(function removeErrors(msg){
			return (msg.type != "error");
		});
		outputMessages.length = 0;

		traverse(ast,collectTypesVisitors);

		outputMessages = [
			...prevMsgs,
			...(
				outputMessages.length > 0 ?
					[{ type: "info", text: `(pass ${passCount}) ------------------------`, }] :
					[]
			),
			...outputMessages,
		];

		// check if we need another traversal or not
		for (let unknownNode of markedUnknowns) {
			if (markedKnowns.has(unknownNode)) {
				continue multipass;
			}
		}

		break;
	}

	for (let msg of outputMessages) {
		if (msg.type == "error") {
			console.error(msg.text);
		}
		else {
			console.log(msg.text);
		}
	}

	return ast;
}
