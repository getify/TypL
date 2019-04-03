(function UMD(context,definition){
	/* istanbul ignore next */if (typeof define === "function" && define.amd) { define(definition); }
	/* istanbul ignore next */else if (typeof module !== "undefined" && module.exports) { module.exports = definition(); }
	/* istanbul ignore next */else { Object.assign(context,definition()); }
})(this,function DEF(){
	"use strict";

	var publicAPI = {
		any, undef, nul, string, bool, number, finite, int, bint,
		symb, array, object, func, regex,
	};
	return publicAPI;


	// ***********************************

	function any(strs,...v) {
		if (strs.length == 1) {
			if (strs[0] === "") return undefined;
			return strs[0];
		}
		else if (
			strs.length > 2 ||
			strs[0].length > 0 ||
			strs[1].length > 0
		) {
			return String.raw({ raw: strs, },...v);
		}
		else {
			return v[0];
		}
	}

	function undef(...v) {
		v = parseSingleInput(v);
		if (
			typeof v == "string" &&
			(
				v === "" ||
				v === "undefined"
			)
		) {
			v = undefined;
		}
		if (v !== undefined) {
			failedTypeAssertion(v,"undefined");
		}
		return v;
	}

	function nul(...v) {
		v = parseSingleInput(v);
		if (
			typeof v == "string" &&
			(
				v === "" ||
				v === "null"
			)
		) {
			v = null;
		}
		if (v !== null) {
			failedTypeAssertion(v,"null");
		}
		return v;
	}

	function string(strs,...v) {
		if (strs.length == 1) {
			return strs[0];
		}
		else {
			// validate the types of all values
			for (let val of v) {
				if (typeof val != "string") {
					failedTypeAssertion(val,"string");
				}
			}

			return any(strs,...v);
		}
	}

	function bool(...v) {
		v = parseSingleInput(v);
		if (typeof v == "string") {
			if (v === "") throw new Error("No default for type: boolean");
			else if (v === "true") v = true;
			else if (v === "false") v = false;
		}
		if (typeof v != "boolean") {
			failedTypeAssertion(v,"boolean");
		}
		return v;
	}

	function number(...v) {
		v = parseSingleInput(v);
		if (typeof v == "string") {
			if (v === "") throw new Error("No default for type: number");
			else if (v == "NaN") v = NaN;
			else {
				let t = Number(v);
				if (typeof t == "number" && !Number.isNaN(t)) {
					v = t;
				}
			}
		}
		if (typeof v != "number") {
			failedTypeAssertion(v,"number");
		}
		return v;
	}

	function finite(...v) {
		v = parseSingleInput(v);
		if (typeof v == "string") {
			if (v === "") throw new Error("No default for type: finite number");
			let t = Number(v);
			if (!Number.isNaN(t)) {
				v = t;
			}
		}
		if (!Number.isFinite(v)) {
			failedTypeAssertion(v,"finite number");
		}
		return v;
	}

	function int(...v) {
		v = parseSingleInput(v);
		if (typeof v == "string") {
			if (v === "") throw new Error("No default for type: integer");
			let t = Number(v);
			if (!Number.isNaN(t)) {
				v = t;
			}
		}
		if (!Number.isSafeInteger(v) || Object.is(v,-0)) {
			failedTypeAssertion(v,"integer");
		}
		return v;
	}

	function bint(...v) {
		v = parseSingleInput(v);
		if (typeof v == "string") {
			if (v === "") throw new Error("No default for type: bigint");
			v = safeEval(v);
		}
		if (typeof v != "bigint") {
			failedTypeAssertion(v,"bigint");
		}
		return v;
	}

	function symb(...v) {
		v = parseSingleInput(v);
		if (typeof v == "string") {
			v = (v != "") ? v : "Symbol()";
			v = safeEval(v);
		}
		if (typeof v != "symbol") {
			failedTypeAssertion(v,"symbol");
		}
		return v;
	}

	function array(...v) {
		var parsedV = parseSingleInput(v);
		if (typeof parsedV == "string") {
			// direct array literal/value?
			if (parsedV == "" || /^\[[^\]]*\]$/.test(parsedV)) {
				return getShapeAndArrayLiteral()(...v);
			}
			// otherwise, first parse annotated array shape
			else {
				return parseArrayShape(parsedV);
			}
		}
		else {
			return getPatternAndArrayLiteral()(...v);
		}

		// **********************************

		function parseArrayShape(str) {
			str = str.trim();

			var tokenizeRE = /[()<>,]|(?:\[\s*\])/g;
			var tokenRE = /[()<>,]|(?:\[\])/;
			var nextMatchIdx = 0;
			var hasTuple = false;
			var stateStack = [ { curr: [], }, ];
			var prevToken = null;
			while (nextMatchIdx < str.length) {
				// 1. TOKENIZE (next tokens)
				let nextTokens = [];

				let match = tokenizeRE.exec(str);
				if (match) {
					if (match.index > nextMatchIdx) {
						let prevToken = str.substring(nextMatchIdx,match.index).trim();
						if (prevToken != "") {
							nextTokens.push(prevToken);
						}
					}

					// normalize the array postfix?
					let token = (/^\[\s*\]$/.test(match[0])) ? "[]" : match[0];

					nextTokens.push(token);
					nextMatchIdx = tokenizeRE.lastIndex;
				}
				else if (nextMatchIdx < str.length) {
					nextTokens.push(str.substring(nextMatchIdx,str.length));
					nextMatchIdx = str.length;
				}

				// 2. PARSE (next tokens)
				for (let token of nextTokens) {
					let state = stateStack[stateStack.length - 1];
					let typeAllowedPosition = (
						prevToken == null ||
						/^[(<,]$/.test(prevToken)
					);

					// array postfix?
					if (
						token == "[]" &&
						state.curr.length > 0 &&
						!typeAllowedPosition
					) {
						let last = state.curr[state.curr.length - 1];
						state.curr[state.curr.length - 1] = {
							type: "array",
							contains: last,
						};
					}
					// opening a grouping (for readability only)?
					else if (
						token == "(" &&
						typeAllowedPosition
					) {
						stateStack.push({
							type: token,
							curr: [],
						});
					}
					// opening a tuple?
					else if (
						token == "<" &&
						(
							state.type == "<" ||
							state.curr.length == 0
						) &&
						typeAllowedPosition
					) {
						hasTuple = true;
						stateStack.push({
							type: token,
							curr: [],
						});
					}
					// closing a grouping?
					else if (
						token == ")" &&
						state &&
						state.type == "(" &&
						state.curr.length > 0
					) {
						stateStack.pop();
						stateStack[stateStack.length - 1].curr.push(...state.curr);
					}
					// closing a tuple?
					else if (
						token == ">" &&
						state &&
						state.type == "<" &&
						state.curr.length > 0 &&
						prevToken != ","
					) {
						let tuple = {
							type: "array",
							contains: state.curr.slice(),
						};

						stateStack.pop();
						stateStack[stateStack.length - 1].curr.push(tuple);
					}
					// comma in sequence?
					else if (
						token == "," &&
						state &&
						state.type == "<" &&
						state.curr.length > 0 &&
						!typeAllowedPosition
					) {
						// comma allowed here
						token;
					}
					// non-delimiter token (aka, a type-ID)?
					else if (
						!tokenRE.test(token) &&
						typeAllowedPosition
					) {
						state.curr.push(token);
					}
					// otherwise, invalid token stream
					else {
						throw new Error(`Invalid array shape descriptor ('${str}'), not allowed: '${token}'`);
					}

					prevToken = token;
				}
			}

			if (stateStack.length != 1) {
				throw new Error(`Invalid array shape descriptor ('${str}'), unterminated: '${stateStack[stateStack.length - 1].type}'`);
			}

			var shape = stateStack[0].curr[0];

			// includes tuple definition? (outer tuple not auto-wrapped in an array)
			if (hasTuple) {
				return shape;
			}
			else {
				return {
					type: "array",
					contains: shape,
				};
			}
		}

		function getShapeAndArrayLiteral(shape) {
			return function array(...v) {
				v = shape ? parseSingleInput(v) : parsedV;
				if (typeof v == "string") {
					v = (v != "") ? v : "[]";
					v = safeEval(v);
				}

				if (!Array.isArray(v)) {
					failedTypeAssertion(v,"array");
				}
				// else if (shape) {

				// }
				return v;
			};
		}
	}

	function object(...v) {
		v = parseSingleInput(v);
		if (typeof v == "string") {
			v = (v != "") ? v : "{}";
			v = safeEval(v);
		}
		if (!(v && typeof v == "object")) {
			failedTypeAssertion(v,"object");
		}
		return v;
	}

	function func(...v) {
		v = parseSingleInput(v);
		if (typeof v == "string") {
			v = (v != "") ? v : "()=>undefined";
			v = safeEval(v);
		}
		if (typeof v != "function") {
			failedTypeAssertion(v,"function");
		}
		return v;
	}

	function regex(strs,...v) {
		// single value (no literals)?
		if (
			strs.length == 2 &&
			strs[0].length == 0 &&
			strs[1].length == 0
		) {
			return validate(v[0]);
		}
		else {
			let t = any(strs,...v) || "";
			t = (t != "") ? t.trim() : "/(?:)/";
			t = safeEval(t);
			return validate(t);
		}


		// ***********************

		function validate(val) {
			if (val && typeof val == "object" && val instanceof RegExp) {
				return val;
			}
			else {
				failedTypeAssertion(val,"regular expression");
			}
		}
	}


	// ***********************************

	function prepareStr(s) {
		return s.trim().replace(/[\n]/g,"\\n").replace(/[\r]/g,"\\r");
	}

	function isNonTrivialStr(s) {
		return /[^\s]/.test(s);
	}

	function parseSingleInput([strs,...v]) {
		// are the inputs invalid?
		if (
			strs.length > 2 ||
			(
				strs.length == 2 &&
				(
					isNonTrivialStr(strs[0]) ||
					isNonTrivialStr(strs[1])
				)
			)
		) {
			// stringify all (invalid) inputs for exception message
			v = v.map(function stringify(val){
				// stringifying some values can throw
				try {
					return String(val);
				}
				catch (e) {
					return "\ufffd";
				}
			});

			v = prepareStr(String(any(strs,...v)));
			throw new Error(`Invalid input: ${v}`);
		}

		// single literal?
		if (strs.length == 1) {
			return strs[0].trim();
		}
		// else single value
		else {
			return v[0];
		}
	}

	function safeEval(s) {
		try {
			return Function(`return (${s.trim()});`)();
		} catch (e) {}
	}

	function failedTypeAssertion(v,expectedType) {
		var t;
		// stringifying some values can throw
		try {
			if (Object.is(v,-0)) t = "-0";
			else t = String(v);
			t = `'${t}'`;
		}
		catch (e) {
			t = "\ufffd";
		}

		t = prepareStr(t);
		throw new Error(`${t} is not type: ${expectedType}`);
	}

});
