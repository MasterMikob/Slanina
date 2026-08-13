#!/usr/bin/env node
/*
 * Generates the <script>-tag delivery path for the language packs from the
 * JSON source of truth, and validates that all locales share an identical key
 * structure. Run from the repo root:  node i18n/build.js
 *
 * Two delivery paths exist because fetch() is blocked on file:// URLs:
 *   i18n/<locale>.json  -> fetched over http(s)
 *   i18n/<locale>.js    -> injected as a <script> tag when location.protocol is file:
 * Both carry identical content. Never hand-edit the .js files.
 */
'use strict';

var fs = require('fs');
var path = require('path');

var DIR = __dirname;
var LOCALES = ['en-AU', 'sr-Cyrl', 'de-AT'];
var FALLBACK = 'en-AU';

function readLocale(code) {
  return JSON.parse(fs.readFileSync(path.join(DIR, code + '.json'), 'utf8'));
}

// Flatten to a sorted list of dotted key paths so structures can be compared.
function keyPaths(obj, prefix, out) {
  out = out || [];
  prefix = prefix || '';
  Object.keys(obj).forEach(function (k) {
    var full = prefix ? prefix + '.' + k : k;
    if (obj[k] && typeof obj[k] === 'object' && !Array.isArray(obj[k])) {
      keyPaths(obj[k], full, out);
    } else {
      out.push(full);
    }
  });
  return out;
}

var packs = {};
LOCALES.forEach(function (code) { packs[code] = readLocale(code); });

// ---- Validate identical key structure ----
var reference = keyPaths(packs[FALLBACK]).sort();
var failed = false;

LOCALES.forEach(function (code) {
  if (code === FALLBACK) return;
  var theirs = keyPaths(packs[code]).sort();
  var missing = reference.filter(function (k) { return theirs.indexOf(k) === -1; });
  var extra = theirs.filter(function (k) { return reference.indexOf(k) === -1; });
  if (missing.length || extra.length) {
    failed = true;
    console.error('\n' + code + ' key structure does not match ' + FALLBACK + ':');
    missing.forEach(function (k) { console.error('  missing: ' + k); });
    extra.forEach(function (k) { console.error('  extra:   ' + k); });
  }
});

// ---- Validate placeholders match across locales ----
function placeholders(str) {
  var found = (String(str).match(/\{[a-zA-Z0-9_]+\}/g) || []).slice().sort();
  return found.join(',');
}

function valueAt(obj, dotted) {
  return dotted.split('.').reduce(function (acc, k) {
    return acc == null ? acc : acc[k];
  }, obj);
}

reference.forEach(function (key) {
  var want = placeholders(valueAt(packs[FALLBACK], key));
  LOCALES.forEach(function (code) {
    if (code === FALLBACK) return;
    var got = placeholders(valueAt(packs[code], key));
    if (got !== want) {
      failed = true;
      console.error('\nPlaceholder mismatch at ' + key + ':');
      console.error('  ' + FALLBACK + ': ' + (want || '(none)'));
      console.error('  ' + code + ': ' + (got || '(none)'));
    }
  });
});

if (failed) {
  console.error('\nBuild aborted — fix the mismatches above.');
  process.exit(1);
}

// ---- Emit the <script>-tag variants ----
LOCALES.forEach(function (code) {
  var body =
    '/* Generated from ' + code + '.json by i18n/build.js — do not edit by hand. */\n' +
    'window.i18n = window.i18n || {};\n' +
    'window.i18n[' + JSON.stringify(code) + '] = ' +
    JSON.stringify(packs[code], null, 2) + ';\n';
  fs.writeFileSync(path.join(DIR, code + '.js'), body, 'utf8');
  console.log('wrote i18n/' + code + '.js');
});

// ---- Inject the inline fallback straight into index.html ----
// The pack is inlined so the app always renders translated text, even offline
// or when a lazy-loaded pack fails. Rewriting it here keeps it from drifting
// away from the JSON source.
var INDEX = path.join(DIR, '..', 'index.html');
var START = '/* i18n:inline:start */';
var END = '/* i18n:inline:end */';

var html = fs.readFileSync(INDEX, 'utf8');
var startAt = html.indexOf(START);
var endAt = html.indexOf(END);

if (startAt === -1 || endAt === -1 || endAt < startAt) {
  console.error('\nCould not find the i18n inline sentinels in index.html.');
  console.error('Expected ' + START + ' ... ' + END);
  process.exit(1);
}

var inline = START + '\nvar EN_AU = ' + JSON.stringify(packs[FALLBACK], null, 2) + ';\n';
html = html.slice(0, startAt) + inline + html.slice(endAt);
fs.writeFileSync(INDEX, html, 'utf8');
console.log('injected inline ' + FALLBACK + ' pack into index.html');

console.log('\nAll ' + LOCALES.length + ' locales share ' + reference.length + ' keys.');
