(function UMD(context,definition){
	/* istanbul ignore next */if (typeof define === "function" && define.amd) { define(definition); }
	/* istanbul ignore next */else if (typeof module !== "undefined" && module.exports) { module.exports = definition(); }
	/* istanbul ignore next */else { Object.assign(context,definition()); }
})(this,function DEF(){
	"use strict";

	return {
		undef, nul, string, bool, number, finite, int, bint,
		float, symb, array, object, func,
	};


	// ***********************************

	function undef(...v) {
		v = getVal(v);
		if (typeof v == "string" && v === "undefined") {
			v = undefined;
		}
		if (v !== undefined) {
			failedTypeAssertion(v,"undefined");
		}
		return v;
	}

	function nul(...v) {
		v = getVal(v);
		if (typeof v == "string" && v === "null") {
			v = null;
		}
		if (v !== null) {
			failedTypeAssertion(v,"null");
		}
		return v;
	}

	function string(strs,...v) {
		checkValidity([strs,...v]);
		if (strs.length == 1) {
			return strs[0];
		}
		else {
			if (typeof v[0] != "string") {
				failedTypeAssertion(v[0],"string");
			}
			return v[0];
		}
	}

	function bool(...v) {
		v = getVal(v);
		if (typeof v == "string") {
			if (v === "true") v = true;
			else if (v === "false") v = false;
		}
		if (typeof v != "boolean") {
			failedTypeAssertion(v,"boolean");
		}
		return v;
	}

	function number(...v) {
		v = getVal(v);
		if (typeof v == "string") {
			if (v === "NaN") v = NaN;
			else {
				let t = strToNum(v);
				if (typeof t == "number" && !isNaN(t)) {
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
		v = getVal(v);
		if (typeof v == "string") {
			let t = strToNum(v);
			if (Number.isFinite(t)) {
				v = t;
			}
		}
		if (!Number.isFinite(v)) {
			failedTypeAssertion(v,"finite number");
		}
		return v;
	}

	function int(...v) {
		v = getVal(v);
		if (typeof v == "string") {
			let t = strToNum(v);
			if (Number.isInteger(t)) {
				v = t;
			}
		}
		if (!Number.isInteger(v)) {
			failedTypeAssertion(v,"integer");
		}
		return v;
	}

	function bint(...v) {
		v = getVal(v);
		if (typeof v == "string") {
			v = safeEval(v);
		}
		if (typeof v != "bigint") {
			failedTypeAssertion(v,"bigint");
		}
		return v;
	}

	function float(...v) {
		v = getVal(v);
		if (typeof v == "string") {
			let t = strToNum(v);
			if (!isNaN(t) && Number.isFinite(t) && !Number.isInteger(t)) {
				v = t;
			}
		}
		if (isNaN(v) || !Number.isFinite(v) || Number.isInteger(v)) {
			failedTypeAssertion(v,"float");
		}
		return v;
	}

	function symb(...v) {
		v = getVal(v);
		if (typeof v == "string") {
			let t = safeEval(v);
			if (typeof t == "symbol") {
				v = t;
			}
		}
		if (typeof v != "symbol") {
			failedTypeAssertion(v,"symbol");
		}
		return v;
	}

	function array(...v) {
		v = getVal(v);
		if (typeof v == "string") {
			let t = safeEval(v);
			if (Array.isArray(t)) {
				v = t;
			}
		}
		if (!Array.isArray(v)) {
			failedTypeAssertion(v,"array");
		}
		return v;
	}

	function object(...v) {
		v = getVal(v);
		if (typeof v == "string") {
			let t = safeEval(v);
			if (t && typeof t == "object") {
				v = t;
			}
		}
		if (!(v && typeof v == "object")) {
			failedTypeAssertion(v,"object");
		}
		return v;
	}

	function func(...v) {
		v = getVal(v);
		if (typeof v == "string") {
			let t = safeEval(v);
			if (t && typeof t == "function") {
				v = t;
			}
		}
		if (typeof v != "function") {
			failedTypeAssertion(v,"function");
		}
		return v;
	}


	// ***********************************

	function isNonTrivialStr(s) {
		return s != "" && /[^\s]/.test(s);
	}

	function checkValidity([strs,...v]) {
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
			try {
				v = String(v[0]);
			}
			catch (e) {
				v = " ";
			}

			throw new Error(`Invalid: ${strs.slice(0,2).join(v)}${strs.length > 2 ? "..." : ""}`);
		}
	}

	function getVal([strs,...v]) {
		checkValidity([strs,...v]);
		if (strs.length == 1) {
			return strs[0].trim();
		}
		else {
			return v[0];
		}
	}

	function safeEval(s) {
		try {
			return Function(`return (${s.trim()});`)();
		} catch (e) {}
	}

	function strToNum(v) {
		if (isNonTrivialStr(v)) {
			return Number(v);
		}
	}

	function failedTypeAssertion(v,expectedType) {
		var t;
		try {
			t = String(v);
		}
		catch (e) {
			t = "*";
		}

		throw new Error(`${typeof v == "string" ? `'${t}'` : t} is not ${expectedType}`);
	}

});

// console.log( nul`null` );
// console.log( undef`undefined` );
// console.log( string`  hello world  ` );
// console.log( bool`true` );
// console.log( number`3.14` );
// console.log( finite`100.1` );
// console.log( int`42` );
// console.log( float`12.6` );
// console.log( array`[1,2,3]` );
// console.log( object`{"a":2,b:3}` );
// console.log( func`x => x * 2` );
