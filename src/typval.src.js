"use strict";

function getVal(s,...v) {
  [s] = s;
  [v] = v;
  if (s && /[^\s]/.test(s)) {
    return s.trim();
  }
  else {
    try {
      s = String(v);
      if (s && /[^\s]/.test(s)) {
        return v;
      }
    } catch (e) {}
  }
  throw "Invalid value!";
}

function safeEval(s) {
  try {
    return Function(`return (${s});`)();
  } catch (e) {}
}

function safeNumber(v) {
  try {
    return Number(v);
  } catch (e) {}
}

function reportError(v,expectedType) {
  throw new Error(`${typeof v == "string" ? `'${v}'` : v} is not ${expectedType}`);
}

function undef(...v) {
  v = getVal(...v);
  if (typeof v == "string") {
    if (v === "undefined") v = undefined;
  }
  if (v !== undefined) {
    reportError(v,"undefined");
  }
  return v;
}

function nul(...v) {
  v = getVal(...v);
  if (typeof v == "string") {
    if (v === "null") v = null;
  }
  if (v !== null) {
    reportError(v,"null");
  }
  return v;
}

function string(...v) {
  v = getVal(...v);
  if (typeof v != "string") {
    reportError(v,"string");
  }
  return v;
}

function number(...v) {
  v = getVal(...v);
  if (typeof v == "string") {
    if (v === "NaN") v = NaN;
    else {
      let t = safeNumber(v);
      if (typeof t == "number" && !isNaN(t)) {
        v = t;
      }
    }
  }
  if (typeof v != "number") {
    reportError(v,"number");
  }
  return v;
}

function finite(...v) {
  v = getVal(...v);
  if (typeof v == "string") {
    let t = safeNumber(v);
    if (Number.isFinite(t)) {
      v = t;
    }
  }
  if (!Number.isFinite(v)) {
    reportError(v,"finite number");
  }
  return v;
}

function bool(...v) {
  v = getVal(...v);
  if (typeof v == "string") {
    if (v === "true") v = true;
    else if (v === "false") v = false;
  }
  if (typeof v != "boolean") {
    reportError(v,"boolean");
  }
  return v;
}

function int(...v) {
  v = getVal(...v);
  if (typeof v == "string") {
    let t = safeNumber(v);
    if (Number.isInteger(t)) {
      v = t;
    }
  }
  if (!Number.isInteger(v)) {
    reportError(v,"integer");
  }
  return v;
}

function bigint(...v) {
  v = getVal(...v);
  if (typeof v == "string") {
    let t = safeEval(v);
  }
  if (typeof v != "bigint") {
    reportError(v,"bigint");
  }
  return v;
}

function float(...v) {
  v = getVal(...v);
  if (typeof v == "string") {
    let t = safeNumber(v);
    if (!isNaN(t) && Number.isFinite(t) && !Number.isInteger(t)) {
      v = t;
    }
  }
  if (isNaN(v) || !Number.isFinite(v) || Number.isInteger(v)) {
    reportError(v,"float");
  }
  return v;
}

function symb(...v) {
  v = getVal(...v);
  if (typeof v == "string") {
    let t = safeEval(v);
    if (typeof t == "symbol") {
      v = t;
    }
  }
  if (typeof v != "symbol") {
    reportError(v,"symbol");
  }
  return v;
}

function array(...v) {
  v = getVal(...v);
  if (typeof v == "string") {
    let t = safeEval(v);
    if (Array.isArray(t)) {
      v = t;
    }
  }
  if (!Array.isArray(v)) {
    reportError(v,"array");
  }
  return v;
}

function object(...v) {
  v = getVal(...v);
  if (typeof v == "string") {
    let t = safeEval(v);
    if (t && typeof t == "object") {
      v = t;
    }
  }
  if (!(v && typeof v == "object")) {
    reportError(v,"object");
  }
  return v;
}

function func(...v) {
  v = getVal(...v);
  if (typeof v == "string") {
    let t = safeEval(v);
    if (t && typeof t == "function") {
      v = t;
    }
  }
  if (typeof v != "function") {
    reportError(v,"function");
  }
  return v;
}

// console.log( nul`null` );
// console.log( undef`undefined` );
// console.log( string`hello` );
// console.log( number`3.14` );
// console.log( finite`100.1` );
// console.log( int`42` );
// console.log( float`12.6` );
// console.log( bool`true` );
// console.log( array`[1,2,3]` );
// console.log( object`{"a":2,b:3}` );
// console.log( func`x => x * 2` );
