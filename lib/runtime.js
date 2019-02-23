(function UMD(context,definition){
	/* istanbul ignore next */if (typeof define === "function" && define.amd) { define(definition); }
	/* istanbul ignore next */else if (typeof module !== "undefined" && module.exports) { module.exports = definition(); }
	/* istanbul ignore next */else { Object.assign(context,definition()); }
})(this,function DEF(){
	"use strict";

	return {
		any, undef, nul, string, bool, number, finite, int, bint,
		symb, array, object, func, regex,
	};


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
		if (!Number.isSafeInteger(v)) {
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
			v = safeEval(v != "" ? v : "Symbol()");
		}
		if (typeof v != "symbol") {
			failedTypeAssertion(v,"symbol");
		}
		return v;
	}

	function array(...v) {
		v = parseSingleInput(v);
		if (typeof v == "string") {
			v = safeEval(v != "" ? v : "[]");
		}
		if (!Array.isArray(v)) {
			failedTypeAssertion(v,"array");
		}
		return v;
	}

	function object(...v) {
		v = parseSingleInput(v);
		if (typeof v == "string") {
			v = safeEval(v != "" ? v : "{}");
		}
		if (!(v && typeof v == "object")) {
			failedTypeAssertion(v,"object");
		}
		return v;
	}

	function func(...v) {
		v = parseSingleInput(v);
		if (typeof v == "string") {
			v = safeEval(v != "" ? v : "()=>void 0");
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
			t = safeEval(t != "" ? t.trim() : "/(?:)/");
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
		// first validate inputs
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
