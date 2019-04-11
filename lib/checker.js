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
	INFO_FUNC_SHAPE: 101,
	INFO_ARR_SHAPE: 102,
	INFO_OBJ_SHAPE: 103,
	INFO_REIMPLY_UNDEF_TAGGED: 104,
	INFO_REIMPLY_UNDEF_INFERRED: 105,
	INFO_IMPLY_PARAM_FROM_ARG_TAGGED: 106,
	INFO_IMPLY_PARAM_FROM_ARG_INFERRED: 107,
	INFO_IMPLY_VAR_TAGGED: 108,
	INFO_IMPLY_VAR_INFERRED: 109,

	ERR_REST_UNDECLARED: 110,
	ERR_REST_TYPE: 111,
	ERR_ASSIGNMENT_UNDECLARED: 112,
	ERR_ASSIGNMENT_TYPE: 113,
	ERR_ASSIGNMENT_SHAPE: 114,
	ERR_CALL_ARG_COUNT: 115,
	ERR_CALL_ARG_COUNT_UNVERIFIABLE: 116,
	ERR_CALL_ARG_SPREAD_TYPE: 117,
	ERR_CALL_ARG_TYPE: 118,
	ERR_CALL_ARG_SHAPE: 119,
	ERR_CALL_NO_SHAPE: 120,
	ERR_BINARY_PLUS_MIXED_TYPES: 121,
	ERR_RELATIVE_OP_MIXED_TYPES: 122,
	ERR_RELATIVE_OP_BOTH_TYPES: 123,
	ERR_RELATIVE_OP_TYPE: 124,
	ERR_LOOSE_EQUALITY_UNKNOWN_TYPE: 125,
	ERR_LOOSE_EQUALITY_MIXED_TYPES: 126,
	ERR_STRICT_EQUALITY_KNOWN_MIXED_TYPES: 127,
	ERR_STRICT_EQUALITY_KNOWN_MATCHING_TYPES: 128,
	ERR_UNARY_NUMERIC_OP_TYPE: 129,
	ERR_MODULUS_OP_BOTH_TYPES: 130,
	ERR_MODULUS_OP_TYPE: 131,
	ERR_BINARY_NUMERIC_OP_TYPE: 132,
	ERR_FUNC_RETURN_TYPE: 133,
	ERR_FUNC_RETURN_SHAPE: 134,
	ERR_TERNARY_COND_TYPE: 135,
	ERR_SPREAD_UNKNOWN_TYPE: 136,
	ERR_SPREAD_TYPE: 137,
	ERR_LOGICAL_COND_TYPE: 138,
	ERR_IN_OP_TYPE: 139,
	ERR_INSTANCEOF_OP_TYPE: 140,
	ERR_IF_CONDITIONAL: 141,
	ERR_WHILE_CONDITIONAL: 142,
	ERR_DO_WHILE_CONDITIONAL: 143,
	ERR_TAGGED_LITERAL_TYPE: 144,
	ERR_TAGGED_LITERAL_SHAPE: 145,
	ERR_TAGGED_INVALID_LITERAL: 146,
	ERR_TAGGED_EXPR_TYPE: 147,
	ERR_TAGGED_EXPR_SHAPE: 148,
	ERR_TOO_MANY_PASSES: 149,
};

var outputMessages = [];

// store any tagged or inferred types for nodes, or
// implied types for bindings
var nodeTypes = new WeakMap();

// store any type shapes (functions, objects,
// arrays, etc)
var typeShapes = new WeakMap();

// store references from shapes back to their
// AST node-paths
var shapeNodePaths = new WeakMap();

// track unknowns for multi-pass
var markedUnknowns = new Set();
var markedKnowns = new Set();

// track types/shapes on current pass only
var currentPass = {
	nodeTypes: null,		// WeakMap
	typeShapes: null,		// WeakMap
};


var collectTypesVisitors = {
	TaggedTemplateExpression: {
		exit(path) {
			handleTaggedTemplateExpression(path);
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
				handleAssignmentExpression(path.scope,path.node,path.node.init,path.node.id);
			}
			// declaration without an init, like `var x;`
			else {
				// was this identifier binding previously marked "unknown"?
				let binding = path.scope.getBinding(path.node.id.name);
				if (markedUnknowns.has(binding)) {
					// mark as "known" (to be `undef`)
					markedKnowns.add(binding);
				}

				markScopeBindingType(path.scope,path.node.id.name,{ inferred: "undef", },path.node.id);
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

			handleAssignmentExpression(path.scope,path.node,path.node.right,path.node.left,/*isAssignmentPattern=*/true);
		},
	},
	AssignmentExpression: {
		exit(path) {
			handleAssignmentExpression(path.scope,path.node,path.node.right,path.node.left);
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

			// setup default type shape for function
			if (!typeShapes.has(path.node)) {
				let funcShape = {
					type: "func",
					params: [],
					hasRestParam: false,
					"return": {
						default: true,
						inferred: "unknown",
					},
				};
				markTypeShape(path.node,funcShape);
				shapeNodePaths.set(funcShape,path);
			}
			else {
				let funcShape = typeShapes.get(path.node);
				funcShape.return.default = true;
			}
		},
		exit(path) {
			var funcShape = typeShapes.get(path.node);

			// exiting an arrow function with expression body?
			if (
				T.isArrowFunctionExpression(path.node) &&
				T.isExpression(path.node.body)
			) {
				if (funcShape.return.default === true) {
					delete funcShape.return.default;
					delete funcShape.return.inferred;
				}

				let returnType;
				if (nodeTypes.has(path.node.body)) {
					returnType = nodeTypes.get(path.node.body);
					markedKnowns.add(funcShape.return);
				}
				else {
					returnType = { inferred: "unknown", };
				}
				Object.assign(funcShape.return,returnType);

				let returnShape = typeShapes.get(path.node.body);
				markTypeShape(funcShape.return,returnShape,/*forceOverride=*/true);
			}
			// NOTE: otherwise, regular function with body
			// did we *not* encounter a `return` statement in the body?
			else if (!funcShape.return.explicit) {
				// finalize the default-return as if a `return;` had been
				// encountered
				delete funcShape.return.default;
			}

			addOutputMessage({
				id: MSG.INFO_FUNC_SHAPE,
				text: `Function '${getOrInferFunctionName(path)}' shape: '${serializeShape(funcShape)}'`,
				node: path.node,
			});
		},
	},
	ReturnStatement: {
		exit(path) {
			var funcNode = path.getFunctionParent().node;
			var funcShape = typeShapes.get(funcNode);

			// NOT a PTC self-recursive return (which we will
			//   skip func-shape registration for)?
			if (!(
				path.node.argument &&
				T.isCallExpression(path.node.argument) &&
				T.isIdentifier(path.node.argument.callee) &&
				funcShape == getScopeBindingShape(path.scope,path.node.argument.callee.name)
			)) {
				funcShape.return.explicit = true;

				let foundReturnType;
				if (path.node.argument) {
					if (nodeTypes.has(path.node.argument)) {
						foundReturnType = nodeTypes.get(path.node.argument);
						markedKnowns.add(funcShape.return);
					}
					else {
						foundReturnType = { inferred: "unknown", };
					}
				}
				else {
					foundReturnType = { inferred: "undef", };
					markedKnowns.add(funcShape.return);
				}

				let functionReturnShape = typeShapes.get(funcShape.return);
				let returnShape = typeShapes.get(path.node.argument);
				if (returnShape) {
					markedKnowns.add(funcShape.return);
				}

				// first encountered `return` in the function?
				if (funcShape.return.default === true) {
					// ...and not an 'unknown' type?
					if (getTypeID(foundReturnType) != "unknown") {
						delete funcShape.return.default;
						delete funcShape.return.inferred;
						Object.assign(funcShape.return,foundReturnType);

						markTypeShape(funcShape.return,returnShape,/*forceOverride=*/true);
					}
				}
				// return types mismatched?
				else if (!isTypeAssignmentAllowed(foundReturnType,funcShape.return)) {
					reportUnexpectedType(
						MSG.ERR_FUNC_RETURN_TYPE,
						"Return type mismatched",
						foundReturnType,
						funcShape.return,
						path.node.argument
					);
				}
				// return type shapes mismatched?
				else if (
					(
						functionReturnShape ||
						returnShape
					) &&
					!isShapeAssignmentAllowed(returnShape,functionReturnShape)
				) {
					reportUnexpectedShape(
						MSG.ERR_FUNC_RETURN_SHAPE,
						"Return shape mismatched",
						returnShape,
						functionReturnShape,
						path.node.argument
					);
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
			handleAssignmentExpression(path.scope,path.parent,path.parent,path.node);
		}
		// any other identifier?
		else {
			let identifierType = getScopeBindingType(path.scope,path.node.name);
			let identifierShape = getScopeBindingShape(path.scope,path.node.name);

			// does identifier's binding have an implied-type from any scope?
			if (identifierType) {
				markNodeType(path.node,{ ...identifierType, });
				markTypeShape(path.node,identifierShape);
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
			registerFuncShapeParams(path.parentPath);
		}
	},
	Expression(path) {
		// entering an arrow function expression (just finished the parameters)?
		if (T.isArrowFunctionExpression(path.parent,{ body: path.node, })) {
			registerFuncShapeParams(path.parentPath);
		}
	},
	ArrayExpression: {
		enter(path) {
			markNodeType(path.node,{ inferred: "array", });

			// setup default type shape for array expression
			if (!typeShapes.has(path.node)) {
				let arrShape = {
					type: "array",
					contains: "any",
					description: "any[]",
				};
				markTypeShape(path.node,arrShape);
				shapeNodePaths.set(arrShape,path);
			}
		},
		exit(path) {
			var arrShape = typeShapes.get(path.node);
			let inferredShape = inferArrayShape(path.node);
			Object.assign(arrShape,inferredShape);

			addOutputMessage({
				id: MSG.INFO_ARR_SHAPE,
				text: `Array literal shape: '${serializeShape(arrShape)}'`,
				node: path.node,
			});
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
				let funcShape = typeShapes.get(funcNode);

				// is the PTC self-recursive?
				isSelfRecursivePTC = (
					T.isIdentifier(path.node.callee) &&
					funcShape == getScopeBindingShape(path.scope,path.node.callee.name)
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
					let funcShape = typeShapes.get(path.node.argument);
					if (funcShape) {
						foundTypeID = getTypeID(funcShape.return);
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
					markScopeBindingType(path.scope,path.node.argument.name,{ inferred: "array", },path.node.argument);
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

function handleTemplateQuasis(path) {
	var isChainedLiteral = (
		T.isTaggedTemplateExpression(path.node.tag)
	);
	var shape = typeShapes.get(path.node);

	// shape wasn't properly parsed in a chained-literal?
	if (isChainedLiteral && !shape) {
		// the rest of the expression can't possibly be validated
		return;
	}

	var tagType = isChainedLiteral ? path.node.tag.tag.name : path.node.tag.name;
	var tagFn = isChainedLiteral ?
		`${tagType}\`${path.node.tag.quasi.quasis[0].value.raw}\`` :
		tagType;
	var quasiNode = path.node.quasi;

	// type-tag attached to a literal (ie, int`42`)?
	if (quasiNode.quasis.length == 1) {
		try {
			Function(`RUNTIME.${tagFn}\`${quasiNode.quasis[0].value.raw}\`;`)();
		}
		catch (err) {
			addOutputMessage({
				id: MSG.ERR_TAGGED_LITERAL_TYPE,
				type: "error",
				text: `(Type-Tag) ${err.toString()}`,
				node: quasiNode.quasis[0],
			});
		}
	}
	// type-tag attached to single-expression literal (ie, int`${x}`)
	else if (
		quasiNode.expressions.length == 1 &&
		T.isTemplateElement(quasiNode.quasis[0]) &&
		T.isTemplateElement(quasiNode.quasis[1]) &&
		(
			// ...and surrounding literal strings are trivial/empty
			(
				quasiNode.quasis[0].value.cooked.trim() == "" &&
				quasiNode.quasis[1].value.cooked.trim() == ""
			) ||
			// ...or type-tag of 'string' (so we can still validate
			// its expression type)
			tagFn == "string"
		)
	) {
		let exprType = getTypeID(nodeTypes.get(quasiNode.expressions[0]));

		// verify as if expression is being assigned to the tag-type
		if (!isTypeAssignmentAllowed(exprType,tagType)) {
			reportUnexpectedType(
				MSG.ERR_TAGGED_EXPR_TYPE,
				"(Type-Tag)",
				exprType,
				tagFn,
				quasiNode.expressions[0]
			);
		}
		// expression has specified shape to match?
		else if (isChainedLiteral) {
			let exprShape = typeShapes.get(quasiNode.expressions[0]);

			// verify shape of inline array expression?
			if (quasiNode.expressions[0].type == "ArrayExpression") {
				if (!validateArrayOfShape(shape,quasiNode.expressions[0])) {
					reportUnexpectedShape(
						MSG.ERR_TAGGED_EXPR_SHAPE,
						"(Type-Tag) Shape mismatch",
						exprShape,
						shape,
						quasiNode.expressions[0]
					);
				}
			}
			// verify shape of inline object expression?
			else if (quasiNode.expressions[0].type == "ObjectExpression") {
				if (!validateObjectOfShape(shape,quasiNode.expressions[0])) {
					reportUnexpectedShape(
						MSG.ERR_TAGGED_EXPR_SHAPE,
						"(Type-Tag) Shape mismatch",
						exprShape,
						shape,
						quasiNode.expressions[0]
					);
				}
			}
			else if (!isShapeAssignmentAllowed(exprShape,shape)) {
				reportUnexpectedShape(
					MSG.ERR_TAGGED_EXPR_SHAPE,
					"(Type-Tag) Shape mismatch",
					exprShape,
					shape,
					quasiNode.expressions[0]
				);
			}
		}
	}
	// not one of the type-tags which allow more than a single input?
	else if (!["any","string","regex",].includes(tagType)) {
		addOutputMessage({
			id: MSG.ERR_TAGGED_INVALID_LITERAL,
			type: "error",
			text: "(Type-Tag) Invalid input",
			node: quasiNode,
		});
	}
}

function handleTaggedTemplateExpression(path) {
	// is this a recognized type-tag?
	if (
		T.isIdentifier(path.node.tag) &&
		recognizedTypeIDs.includes(path.node.tag.name) &&
		T.isTemplateLiteral(path.node.quasi)
	) {
		let quasiNode = path.node.quasi;

		// verify and mark array shape?
		if (
			path.node.tag.name == "array" &&
			quasiNode.quasis.length == 1 &&
			!/^\s*\[.*\]\s*$/s.test(quasiNode.quasis[0].value.cooked)
		) {
			try {
				// parse array shape
				let shape = RUNTIME.array({ parseShapeOnly: true, v: [quasiNode.quasis[0].value.cooked,], });

				// mark shape
				markTypeShape(path.node,shape);

				// is chained literal (mark shape on parent)?
				if (
					path.node.tag.name == "array" &&
					quasiNode.quasis.length == 1 &&
					T.isTaggedTemplateExpression(path.parent) &&
					path.parent.tag == path.node
				) {
					markTypeShape(path.parent,shape);
				}
			}
			catch (err) {
				addOutputMessage({
					id: MSG.ERR_TAGGED_LITERAL_SHAPE,
					type: "error",
					text: `(Type-Tag) ${err.toString()}`,
					node: quasiNode.quasis[0],
				});
			}
		}
		// verify and mark object shape?
		else if (
			path.node.tag.name == "object" &&
			quasiNodei.quasis.length == 1 &&
			!/^\s*{.*}\s*$/s.test(quasiNode.quasis[0].value.cooked)
		) {
			// TODO: handle object shape annotation
		}
		// otherwise, treat as a normal tagged-type expression
		else {
			handleTemplateQuasis(path);
		}
	}
	// is chained tagged-type expression (with shape annotation)?
	else if (
		T.isTaggedTemplateExpression(path.node.tag) &&
		T.isIdentifier(path.node.tag.tag) &&
		["array","object",].includes(path.node.tag.tag.name)
	) {
		markNodeType(path.node,nodeTypes.get(path.node.tag));
		handleTemplateQuasis(path);
	}
	else {
		// TODO: add handling of tagged-literal as call-expression (#32)
	}
}

function inferArrayShape(node) {
	var shape = {
		type: "array",
		contains: "any",
		description: "any[]",
	};

	if (node.elements.length > 0) {
		let foundTypes = [];
		let foundShapes = [];
		for (let elem of node.elements) {
			if (elem) {
				let type = nodeTypes.get(elem);
				let typeID = getTypeID(type);
				if (typeID == "unknown") {
					foundTypes = ["unknown",];
					break;
				}
				else if (!foundTypes.includes(typeID)) {
					foundTypes.push(typeID);
				}

				let shape = typeShapes.get(elem);
				if (shape && shape.type == "array") {
					let matchingShape = foundShapes.find(function matchShape(foundShape){
						return foundShape.description == shape.description;
					});
					if (!matchingShape) {
						foundShapes.push(shape);
					}
				}
			}
			// empty/elided array element
			else if (!foundTypes.includes("undef")) {
				foundTypes.push("undef");
			}
		}

		if (foundShapes.length > 1) {
			Object.assign(shape,buildNestedArrayAnyShape(foundShapes));
		}
		else if (foundTypes.length > 1) {
			// TODO: add union type support here
		}
		else if (foundShapes.length == 1) {
			shape.contains = foundShapes[0];
			shape.description = `${shape.contains.description}[]`;
		}
		else {
			shape.contains = foundTypes[0];
			shape.description = `${shape.contains}[]`;
		}
	}

	return shape;
}

function buildNestedArrayAnyShape(shapes) {
	var minBracketsCount = Infinity;
	for (let shape of shapes) {
		if (typeof shape == "object") {
			let [brackets,] = shape.description.match(/(?:\[\+?\])+$/) || [];
			let bracketsCount =	brackets ? brackets.match(/\[\+?\]/g).length : 0;
			if (bracketsCount < minBracketsCount) {
				minBracketsCount = bracketsCount;
			}
		}
	}

	// construct shape structure representing nested 'any's
	var shape = {
		type: "array",
		contains: "any",
		description: "any[]",
	};
	for (let i = 0; i < minBracketsCount; i++) {
		shape = {
			type: "array",
			contains: shape,
			description: `${shape.description}[]`,
		};
	}
	return shape;
}

function validateArrayOfShape(shape,arrNode) {
	// array must contain elements of only this type?
	if (typeof shape.contains == "string") {
		// non-empty array not allowed?
		if (
			shape.nonEmpty &&
			arrNode.elements.length == 0
		) {
			return false;
		}

		for (let elem of arrNode.elements) {
			let type = nodeTypes.get(elem);
			if (!isTypeAssignmentAllowed(type,shape.contains)) {
				return false;
			}
		}

		return true;
	}
	// array is a tuple and must contain all and only these elements (of types)
	else if (Array.isArray(shape.contains)) {
		for (let [idx,elem,] of arrNode.elements.entries()) {
			let elemType = nodeTypes.get(elem);
			let elemShape = typeShapes.get(elem);

			if (idx >= shape.contains.length) {
				return false;
			}
			else if (elem.type == "ArrayExpression") {
				if (!validateArrayOfShape(shape.contains[idx],elem)) {
					return false;
				}
			}
			else if (typeof shape.contains[idx] == "string") {
				if (!isTypeAssignmentAllowed(elemType,shape.contains[idx])) {
					return false;
				}
			}
			else if (elemShape) {
				if (!isShapeAssignmentAllowed(elemShape,shape.contains[idx])) {
					return false;
				}
			}
			else {
				return false;
			}
		}
		if (arrNode.elements.length < shape.contains.length) {
			return false;
		}

		return true;
	}
	// otherwise, must include nested arrays-of-type
	else {
		if (arrNode.elements.length == 0) {
			return false;
		}

		// check all elements in nested arrays
		for (let elem of arrNode.elements) {
			let elemType = nodeTypes.get(elem);

			if (elem.type == "ArrayExpression") {
				if (!validateArrayOfShape(shape.contains,elem)) {
					return false;
				}
			}
			else {
				let elemShape = typeShapes.get(elem);
				if (!isShapeAssignmentAllowed(elemShape,shape.contains)) {
					return false;
				}
			}
		}

		return true;
	}
}

function validateObjectOfShape(shape,obj) {
	// TODO: define object-shape matching
	return true;
}

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

function registerFuncShapeParams(path) {
	var funcNode = path.node;
	var funcShape = typeShapes.get(funcNode);

	for (let [paramIdx,param,] of funcNode.params.entries()) {
		let paramType = nodeTypes.get(param);
		if (paramType) {
			// don't save a ...rest element into the shape,
			// but flag its presence (for shape checking)
			if (paramType.isRest) {
				funcShape.hasRestParam = true;
				break;
			}
			else {
				if (!funcShape.params[paramIdx]) {
					paramType = { ...paramType, };
					funcShape.params[paramIdx] = paramType;
				}
				else if (!typesMatch(funcShape.params[paramIdx],paramType)) {
					let prevType = funcShape.params[paramIdx];
					delete prevType.inferred;
					Object.assign(prevType,paramType);
					paramType = prevType;
				}
				else {
					paramType = funcShape.params[paramIdx];
				}

				// need to register a param's shape?
				let paramShape = typeShapes.get(param);
				markTypeShape(paramType,paramShape);
			}
		}
		else if (!funcShape.params[paramIdx]) {
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

			funcShape.params[paramIdx] = { inferred: "unknown", };
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
		else {
			return "(anonymous)";
		}
	}
	else if (
		T.isProperty(parentNode) ||
		T.isClassProperty(parentNode)
	) {
		let key = parentNode.key;
		if (T.isIdentifier(key)) {
			return key.name;
		}
		else if (T.isLiteral(key)) {
			return key.value;
		}
		else {
			return "(anonymous)";
		}
	}
	else if (
		(
			T.isAssignmentExpression(parentNode) ||
			T.isAssignmentPattern(parentNode)
		) &&
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

function reportUnexpectedShape(errID,label,foundShape,expectedShape,node) {
	addOutputMessage({
		id: errID,
		type: "error",
		text: `${label}: expected shape '${serializeShape(expectedShape)}', but found shape '${serializeShape(foundShape)}'`,
		node,
	});
}

function serializeShape(shape) {
	if (!shape) {
		return "(unknown)";
	}

	if (shape.type == "func") {
		let params = serializeTypesList(shape.params);
		let restParam =
			(shape.hasRestParam && shape.params.length > 0)  ? ",..." :
			(shape.hasRestParam && shape.params.length == 0) ? "..."  :
			"";
		return `(${params}${restParam}) => ${serializeType(shape.return)}`;
	}
	else if (shape.type == "array") {
		return shape.description;
	}
	else if (shape.type == "object") {
		return shape.description;
	}
	else {
		return shape;
	}
}

function serializeTypesList(types) {
	var str = "";
	for (let [idx,type,] of types.entries()) {
		str += serializeType(type);
		if (idx < (types.length - 1)) {
			str += ",";
		}
	}
	return str;
}

function serializeType(type) {
	var typeShape = typeShapes.get(type);
	if (typeShape) {
		return serializeShape(typeShape);
	}
	else {
		return getTypeID(type);
	}
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
	var [leftType,rightType,] = binaryExpressionTypes(exprNode);
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
	var [leftType,rightType,] = binaryExpressionTypes(exprNode);

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
	var [leftType,rightType,] = binaryExpressionTypes(exprNode);
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
	var [leftType,rightType,] = binaryExpressionTypes(exprNode);
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

function handleAssignmentExpression(scope,exprNode,sourceNode,targetNode,isAssignmentPattern = false) {
	// target is simple identifier?
	if (T.isIdentifier(targetNode)) {
		let targetBinding = scope.getBinding(targetNode.name);

		if (targetBinding) {
			let targetType = nodeTypes.get(targetBinding);
			let targetShape = typeShapes.get(targetBinding);
			let sourceType = nodeTypes.get(sourceNode);
			let sourceTypeID = getTypeID(sourceType);
			let sourceShape = typeShapes.get(sourceNode);

			// source expression has a recognized type?
			if (sourceType && sourceTypeID != "unknown") {
				if (exprNode) {
					markNodeType(exprNode,{ ...sourceType, });
				}

				// target has no implied type (or not yet set on this pass)?
				if (
					!targetType ||
					!currentPass.nodeTypes.has(targetBinding)
				) {
					markNodeType(targetNode,{ ...sourceType, });
					markScopeBindingType(scope,targetNode.name,sourceType,sourceNode);

					markedKnowns.add(targetBinding);
				}
				// target already has an implied type
				else if (targetType) {
					if (!isTypeAssignmentAllowed(sourceType,targetType)) {
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
					else if (
						(
							sourceShape ||
							targetShape
						) &&
						!isShapeAssignmentAllowed(sourceShape,targetShape)
					) {
						reportUnexpectedShape(
							MSG.ERR_ASSIGNMENT_SHAPE,
							"Assignment shape mismatch",
							sourceShape,
							targetShape,
							sourceNode
						);
					}
				}

				// need to associate shape with the target?
				if (
					sourceShape &&
					(
						!targetShape ||
						!currentPass.typeShapes.has(targetBinding)
					)
				) {
					markedKnowns.add(targetBinding);

					markTypeShape(targetBinding,sourceShape);
					if (exprNode) {
						markTypeShape(exprNode,sourceShape);
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
				markNodeType(exprNode,{ ...sourceType, });
			}
			else {
				markNodeType(exprNode,{ inferred: "array", });
			}
		}

		if (T.isArrayExpression(sourceNode)) {
			for (let [idx,targetElem,] of targetNode.elements.entries()) {
				// target is identifier with a default = value assignment?
				if (T.isAssignmentPattern(targetElem)) {
					targetElem = targetElem.left;
				}
				let sourceElem = sourceNode.elements[idx];
				if (sourceElem) {
					handleAssignmentExpression(scope,null,sourceElem,targetElem,isAssignmentPattern);
				}
			}
		}
	}
	// target is object destructuring pattern?
	else if (T.isObjectPattern(targetNode)) {
		if (exprNode) {
			let sourceType = nodeTypes.get(sourceNode);
			if (sourceType) {
				markNodeType(exprNode,{ ...sourceType, });
			}
			else {
				markNodeType(exprNode,{ inferred: "object", });
			}
		}

		if (T.isObjectExpression(sourceNode)) {
			for (let [idx,targetProp,] of targetNode.properties.entries()) {
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
					handleAssignmentExpression(scope,null,sourceProp.value,targetProp,isAssignmentPattern);
				}
			}
		}
	}
}

function handleCallExpression(scope,callExprNode,isSelfRecursivePTC = false) {
	var calleeName;
	var funcShape;

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
			if (typeShapes.has(nativeFn)) {
				funcShape = typeShapes.get(nativeFn);
			}
			else {
				// setup default shape for natives
				funcShape = {
					type: "func",
					params: [ { tagged: "any", }, ],
					hasRestParam: false,
					"return": {
						inferred: nativesReturnTypes[calleeName],
					},
				};
				typeShapes.set(nativeFn,funcShape);
			}

			markNodeType(callExprNode,{ inferred: nativesReturnTypes[calleeName], });
		}
		else {
			funcShape = getScopeBindingShape(scope,calleeName);
		}
	}
	// IIFE?
	else if (T.isFunctionExpression(callExprNode.callee)) {
		// NOTE: no need for `calleeName` to be set/inferred, since
		// we definitely have a shape for an IIFE's function
		funcShape = typeShapes.get(callExprNode.callee);
	}

	// did we find a function shape to check the call-expression against?
	if (funcShape) {
		let returnType;

		// no return found in function?
		if (funcShape.return.default === true) {
			returnType = { inferred: "unknown", };
		}
		else {
			let tmp;
			({ default: tmp, ...returnType } = funcShape.return);
			markNodeType(callExprNode,{ ...returnType, });
		}

		if (getTypeID(returnType) != "unknown") {
			let funcReturnShape = typeShapes.get(funcShape.return);
			markTypeShape(callExprNode,funcReturnShape);
		}
		// NOTE: self-recursive PTC will never answer the return-type
		// of a function
		else if (!isSelfRecursivePTC) {
			// flag as needing multi-pass resolution for this call
			// expressions's result
			markedUnknowns.add(funcShape.return);
		}

		// collect argument-types (and shapes) for call-expression
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
				// call-expression) have a shape?
				let argShape = typeShapes.get(arg);
				markTypeShape(argType,argShape);
			}
			else {
				callExpressionArgumentTypes.push({ inferred: "unknown", });
			}
		}

		// check count of arguments vs parameters
		if (
			(
				!funcShape.hasRestParam &&
				callExpressionArgumentTypes.length > funcShape.params.length
			) ||
			(
				callExpressionArgumentTypes.length < funcShape.params.length
			)
		) {
			if (countVerifiable) {
				addOutputMessage({
					id: MSG.ERR_CALL_ARG_COUNT,
					type: "error",
					text: `Expected ${funcShape.params.length} arguments, found ${callExpressionArgumentTypes.length}`,
					node: callExprNode,
				});
			}
			else {
				addOutputMessage({
					id: MSG.ERR_CALL_ARG_COUNT_UNVERIFIABLE,
					type: "error",
					text: `Expected ${funcShape.params.length} arguments, could not verify count because of a \`...\` spread`,
					node: callExprNode,
				});
			}
		}

		// compare argument types/shapes to parameter types/shapes
		let funcNodePath = shapeNodePaths.get(funcShape);
		let funcNodeScope = funcNodePath ? funcNodePath.scope : undefined;
		let funcNode = funcNodePath ? funcNodePath.node : undefined;
		for (let [argIdx,argType,] of callExpressionArgumentTypes.entries()) {
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
			if (argIdx < funcShape.params.length) {
				let paramType = funcShape.params[argIdx];
				let paramTypeID = getTypeID(paramType);
				let paramShape = typeShapes.get(paramType);

				let argTypeID = getTypeID(argType);
				let argShape = typeShapes.get(argType);

				if (paramTypeID != "unknown") {
					// NOTE: using `isTypeAssignmentAllowed(..)` here because
					// conceptually arguments are "assigned" to parameters
					if (!isTypeAssignmentAllowed(argType,paramType)) {
						reportUnexpectedType(
							MSG.ERR_CALL_ARG_TYPE,
							"Argument type mismatch",
							argType,
							paramType,
							callExprNode.arguments[argIdx]
						);
					}
					else if (
						paramShape &&
						!isShapeAssignmentAllowed(argShape,paramShape)
					) {
						reportUnexpectedShape(
							MSG.ERR_CALL_ARG_SHAPE,
							"Argument shape mismatch",
							argShape,
							paramShape,
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
						funcShape.params[argIdx] = funcParamType;
						markNodeType(funcParam,funcParamType);
						markNodeType(funcParamBinding,funcParamType);

						markedKnowns.add(funcParamBinding);

						if (argShape) {
							markTypeShape(funcParamType,argShape);
							markTypeShape(funcParamBinding,argShape);
						}

						// NOTE: temporary debugging output
						if (isTaggedType(funcParamType)) {
							addOutputMessage({
								id: MSG.INFO_IMPLY_PARAM_FROM_ARG_TAGGED,
								text: `Implying parameter ${funcParamName} from argument, as tagged-type '${argTypeID}'${argShape ? ` (and shape: ${serializeShape(argShape)})` : ""}`,
								node: callExprNode.arguments[argIdx],
							});
						}
						else {
							addOutputMessage({
								id: MSG.INFO_IMPLY_PARAM_FROM_ARG_INFERRED,
								text: `Implying parameter ${funcParamName} from argument, as inferred-type '${argTypeID}'${argShape ? ` (and shape: ${serializeShape(argShape)})` : ""}`,
								node: callExprNode.arguments[argIdx],
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
			id: MSG.ERR_CALL_NO_SHAPE,
			type: "error",
			text: `Could not find shape to check function call '${calleeName}(..)'`,
			node: callExprNode,
		});

		// flag as needing multi-pass resolution for this function
		// shape
		let binding = scope.getBinding(calleeName);
		if (binding) {
			markedUnknowns.add(binding);
		}
	}
}

function markScopeBindingType(scope,bindingName,type,refNode) {
	var binding = scope.getBinding(bindingName);
	// found a scope binding with no implied type?
	if (
		binding &&
		(
			!nodeTypes.has(binding) ||
			!currentPass.nodeTypes.has(binding)
		)
	) {
		markNodeType(binding,{ ...type, });

		// NOTE: temporary debugging output
		let typeID = getTypeID(type);
		if (isTaggedType(type)) {
			addOutputMessage({
				id: MSG.INFO_IMPLY_VAR_TAGGED,
				text: `Implying ${bindingName} as tagged-type '${typeID}'`,
				node: refNode,
			});
		}
		else {
			addOutputMessage({
				id: MSG.INFO_IMPLY_VAR_INFERRED,
				text: `Implying ${bindingName} as inferred-type '${typeID}'`,
				node: refNode,
			});
		}
	}
}

function getScopeBindingType(scope,bindingName) {
	var binding = scope.getBinding(bindingName);
	if (binding && nodeTypes.has(binding)) {
		return nodeTypes.get(binding);
	}
}

function getScopeBindingShape(scope,bindingName) {
	var binding = scope.getBinding(bindingName);
	if (binding && typeShapes.has(binding)) {
		return typeShapes.get(binding);
	}
}

function binaryExpressionTypes(node) {
	var leftType = nodeTypes.has(node.left) ?
		nodeTypes.get(node.left) :
		{ inferred: "unknown", };
	var rightType = nodeTypes.has(node.right) ?
		nodeTypes.get(node.right) :
		{ inferred: "unknown", };

	return [leftType,rightType,];
}

function isShapeAssignmentAllowed(sourceShape,targetShape) {
	if (sourceShape === targetShape) {
		return true;
	}

	if (!(
		sourceShape &&
		targetShape &&
		sourceShape.type &&
		targetShape.type &&
		sourceShape.type == targetShape.type
	)) {
		return false;
	}

	if (sourceShape.type == "func") {
		if (sourceShape.params.length != targetShape.params.length) {
			return false;
		}

		// check all source params against target params
		for (let [idx,sourceParamType,] of sourceShape.params.entries()) {
			let targetParamType = targetShape.params[idx];

			// NOTE: intentionally swapping the order of these arguments, because
			// for one function to substitute for another, anything that was valid
			// to pass to the original function has to be valid pass to the new
			// function value.
			if (!isTypeShapeAssignmentAllowed(targetParamType,sourceParamType)) {
				return false;
			}
		}

		// check source return against target return
		if (!isTypeShapeAssignmentAllowed(sourceShape.return,targetShape.return)) {
			return false;
		}

		// otherwise, function signatures must be compatible
		return true;
	}
	else if (sourceShape.type == "array") {
		let isSourceTuple = Array.isArray(sourceShape.contains);
		let isTargetTuple = Array.isArray(targetShape.contains);

		// any kind of array can be assigned to 'any[]'
		if (targetShape.contains == "any") {
			return true;
		}

		// both source and target are arrays containing simple
		// (non-array, non-tuple) types?
		if (
			typeof sourceShape.contains == "string" &&
			typeof targetShape.contains == "string"
		) {
			return isTypeAssignmentAllowed(sourceShape.contains,targetShape.contains);
		}
		// source is a tuple?
		else if (isSourceTuple) {
			// check source tuple members against target
			for (let [idx,sourceTupleMember,] of sourceShape.contains.entries()) {
				// both source and target are tuples?
				if (isTargetTuple) {
					let targetTupleMember = targetShape.contains[idx];

					// both tuple members are simple?
					if (
						typeof sourceTupleMember == "string" &&
						typeof targetTupleMember == "string"
					) {
						if (!isTypeAssignmentAllowed(sourceTupleMember,targetTupleMember)) {
							return false;
						}
					}
					// both tuple members are nested tuples/arrays?
					else if (
						typeof sourceTupleMember == "object" &&
						typeof targetTupleMember == "object"
					) {
						if (!isShapeAssignmentAllowed(sourceTupleMember,targetTupleMember)) {
							return false;
						}
					}
					// otherwise, tuple members can't be compatible
					else {
						return false;
					}
				}
				// source tuple member (array/tuple) NOT assignable to
				// target's nested array type (array/tuple)?
				else if (
					typeof sourceTupleMember != "string" &&
					!isShapeAssignmentAllowed(sourceTupleMember,targetShape.contains)
				) {
					return false;
				}
			}

			// checked all the source tuple members against target,
			// no incompatibilities found
			return true;
		}
		// both source and target are NOT tuples but rather arrays
		// containing tuples or nested arrays?
		else if (!isTargetTuple) {
			return isShapeAssignmentAllowed(sourceShape.contains,targetShape.contains);
		}

		// shapes must be incompatible in terms of assigning source to target
		return false;
	}

	// TODO: remove this eventually
	throw new Error("Should never get here.");
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

function isTypeAssignmentAllowed(sourceType,targetType) {
	if (typesMatch(sourceType,targetType)) {
		return true;
	}

	var matches = {
		any: recognizedTypeIDs,
		number: [ "number", "int", "finite", ],
		finite: [ "finite", "int", ],
		bint: [ "bint", "int", ],
	};

	var sourceTypeID = getTypeID(sourceType);
	var targetTypeID = getTypeID(targetType);

	return (
		matches[targetTypeID] &&
		matches[targetTypeID].includes(sourceTypeID)
	);
}

function isTypeShapeAssignmentAllowed(sourceType,targetType) {
	if (!isTypeAssignmentAllowed(sourceType,targetType)) {
		return false;
	}

	var sourceShape = typeShapes.get(sourceType);
	var targetShape = typeShapes.get(targetType);

	if (
		(
			sourceShape ||
			targetShape
		) &&
		!isShapeAssignmentAllowed(sourceShape,targetShape)
	) {
		return false;
	}

	return true;
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
		(typeof type == "string") ? type :
		isTaggedType(type) ? type.tagged :
		isInferredType(type) ? type.inferred :
		"unknown"
	);
}

function markNodeType(node,type,forceOverride = false) {
	let prevType = nodeTypes.get(node);
	let currentPassPrevType = currentPass.nodeTypes.get(node);

	if (
		type &&
		(
			forceOverride ||
			getTypeID(prevType) == "unknown" ||
			getTypeID(currentPassPrevType) == "unknown"
		)
	) {
		nodeTypes.set(node,type);
		currentPass.nodeTypes.set(node,type);
	}
}

function markTypeShape(node,shape,forceOverride = false) {
	if (
		shape &&
		(
			forceOverride ||
			!typeShapes.has(node) ||
			!currentPass.typeShapes.has(node)
		)
	) {
		typeShapes.set(node,shape);
		currentPass.typeShapes.set(node,shape);
	}
}

function addOutputMessage({ type = "info", id = -1, text = "?",  node = {}, } = {}) {
	let textWithLoc = node.loc ?
		`${text}, at line ${node.loc.start.line}, column ${node.loc.start.column}` :
		text;
	outputMessages.push({ type, id, text: textWithLoc, });
}

function check(code, options = {}) {
	var { verbose = true, } = options;
	var ast = babylon.parse(code);
	var needAnotherPass = false;

	multipass: for (let passCount = 1; passCount <= PASS_LIMIT; passCount++) {
		currentPass.nodeTypes = new WeakMap();
		currentPass.typeShapes = new WeakMap();

		needAnotherPass = false;
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
				(outputMessages.length > 0) ?
					[{ type: "info", text: `(pass ${passCount}) ------------------------`, },] :
					[]
			),
			...outputMessages,
		];

		// check if we need another traversal or not
		for (let unknownNode of markedUnknowns) {
			if (markedKnowns.has(unknownNode)) {
				needAnotherPass = true;
				continue multipass;
			}
		}

		break;
	}

	// did we stop "early" because we hit the pass-count limit?
	if (needAnotherPass) {
		addOutputMessage({
			id: MSG.ERR_TOO_MANY_PASSES,
			type: "error",
			text: `Error: needed too many passes (limit: ${PASS_LIMIT})`,
		});
	}

	if (verbose) {
		for (let msg of outputMessages) {
			if (msg.type == "error") {
				console.error(msg.text);
			}
			else {
				console.log(msg.text);
			}
		}
	}

	return { ast, outputMessages, };
}
