#!/usr/local/bin/node
/*
This script parses the ast-json format on stdin,
extracts the tokens and creates a new simpler array-of-arrays
data structure, [[tokenType, literal], ...], which is
written to stdout and also saved to [filename.rs.tokens].

*/
const { execSync } = require('child_process');

let fs = require('fs');

// let stateFile = '/tmp/rust-tokens.json';
let sourceFile = process.argv[2];
let tokensFile = sourceFile + '.tokens';

if (sourceFile == null) {
    console.log('Usage: rustc-ast-json-tokenizer.js [filename.rs]');
    return;
} else if (!fs.existsSync(sourceFile)) {
    console.error('File does not exist: ' + sourceFile);
    return;
} else if (fs.existsSync(tokensFile)) {
    console.log(sourceFile + ' has already been processed, skipping');
    return;
}

// The -Zast-json-noexpand option is only available for the "nightly" rust version.
let AST = JSON.parse(execSync('rustc -Zast-json-noexpand ' + sourceFile, {'timeout': 1000}));

// Some token types cannot be derived since they don't exist in the ast_json-data
// and therefore need to be hard-coded manually:
let tokenTypes = {
    'doc': 'Ident',
    '#': 'Pound',
    '!': 'Not',
    '{': 'LBrace',
    '}': 'RBrace',
    '(': 'LParen',
    ')': 'RParen',
    '[': 'LBracket',
    ']': 'RBracket',
};

// if (fs.existsSync(stateFile)) {
//     tokenTypes = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
// }

let sourceCode = Buffer.from(fs.readFileSync(sourceFile, 'utf8'));

// Detect if there is a magic byte-order-mark sequence in the beginning of the file:
let BOM = null;
if (sourceCode[0] == 239
    && sourceCode[1] == 187
    && sourceCode[2] == 191
) {
    // Remove byte order mark
    BOM = sourceCode.slice(0,3);
    sourceCode = sourceCode.slice(3, sourceCode.length);
}

let tokens = [];

function newToken(tokenType, path, hiLo, tokenStrInJSON) {
    if (tokenType == null || path == null || hiLo == null) {
        throw new Error('Invalid arguments');
    }
    if (tokenType == 'Eq' && (hiLo.hi - hiLo.lo) > 1) {
        return false;
    }
    if (hiLo.hi > sourceCode.length) {
        console.error('Cannot process "' + sourceFile +
            '", insane ast-json data, byte position hiLo.hi (' + hiLo.hi +
            ') exceeds file size (' + sourceCode.length + ')');
        process.exit(1);
    }
    let tokenStr = sourceCode.toString('utf8', hiLo.lo, hiLo.hi);
    tokenTypes[tokenStr] = tokenType;
    return true;
}

function traverse(AST, path = '') {
    if (!AST) {
        return null;
    }
    if (AST.constructor === Array) {
        let i = 0;
        for (let element of AST) {
            traverse(element, path + '[' + i + ']');
            i++;
        }
    } else if (AST.constructor === Object) {
        if (AST.variant == 'Token' && typeof AST.fields[1] === 'string') {
            newToken(AST.fields[1], path, AST.fields[0]);
        } else if (AST.variant == 'Token'
            && AST.fields
            && AST.fields[1].variant
            && AST.fields[1].variant == 'Ident'
            && AST.fields[1].fields
        ) {
            newToken(AST.fields[1].variant, path, AST.fields[0], AST.fields[1].fields[0]);
        } else if (AST.variant == 'Token'
            && AST.fields
            && AST.fields[1].variant
            && AST.fields[1].variant == 'Lifetime'
            && AST.fields[1].fields
        ) {
            newToken(AST.fields[1].variant, path, AST.fields[0], AST.fields[1].fields[0]);
        } else if (AST.variant == 'Token'
            && AST.fields
            && AST.fields[1].variant
            && AST.fields[1].variant == 'DocComment'
            && AST.fields[1].fields
        ) {
            newToken(AST.fields[1].variant, path, AST.fields[0], AST.fields[1].fields[0]);
        } else if (AST.variant == 'Token'
            && AST.fields
            && AST.fields[1].variant
            && AST.fields[1].variant == 'BinOp'
            && AST.fields[1].fields
        ) {
            newToken(AST.fields[1].fields[0], path, AST.fields[0]);
        } else if (AST.variant == 'Token'
            && AST.fields
            && AST.fields[1].variant
            && AST.fields[1].variant == 'BinOpEq'
            && AST.fields[1].fields
        ) {
            newToken(AST.fields[1].fields[0] + 'Eq', path, AST.fields[0]);
        } else if (AST.variant == 'Token'
            && AST.fields
            && AST.fields[1].variant
            && AST.fields[1].variant == 'Literal'
            && AST.fields[1].fields
            && AST.fields[1].fields[0]
            && AST.fields[1].fields[0].variant
            && AST.fields[1].fields[0].fields
        ) {
            newToken(AST.fields[1].fields[0].variant, path, AST.fields[0], AST.fields[1].fields[0].fields[0]);
        } else if (AST.variant == 'Delimited'
            && AST.fields
            && AST.fields[1].delim
            && AST.fields[1].tts
        ) {
            traverse(AST.fields[1].tts, path + '[tts]');
        } else if (AST.path
            && AST.path.segments
            && AST.path.segments[0]
            && AST.path.segments[0].ident == 'doc'
            && AST.tokens
        ) {
            traverse(AST.tokens, path + '[tokens]');
        } else if (AST.path
            && AST.path.span
            && AST.path.segments
            && AST.path.segments[0]
            && AST.path.segments[0].ident
            && AST.tokens
        ) {
            newToken('Ident', path, AST.path.span, AST.path.segments[0].ident);
            traverse(AST.tokens, path + '[tokens]');
        } else if (AST.variant == 'Token') {
            console.log('Cannot handle: ' + JSON.stringify(AST));
        } else {
            if (AST && AST.constructor === Object && AST.hasOwnProperty('attrs')) {
                // Need to process attrs first as e.g. //! documentation comments are here
                traverse(AST['attrs'], path + '[attrs]');
            }
            for (let key in AST) {
                if (key == 'attrs') {
                    // Proceed already above
                    continue;
                } else if (key == 'node') {
                    // Need to skip as tokens are duplicted here in the tree.
                    continue;
                }
                traverse(AST[key], path + '[' + key + ']');
            }
        }
    }
}

traverse(AST);

let lastPos = 0;
let resultTokens = [];

let str = sourceCode.toString();

while (str.length > 0) {
    // White space and comments are not present in the ast-json data
    // so we will have to parse it manually:
    let m = str.match(/^(?:(\s+)|(\/\/.*(?:[\n]|$))|(\/\*[\s\S]*?\*\/))/);
    if (m) {
        let nodeType;
        if (m[1]) {
            nodeType = 'WS';
        } else if (m[2]) {
            nodeType = 'LineComment';
        } else if (m[3]) {
            nodeType = 'BlockComment';
        } else {
            throw new Error('No capture group matched:' + m);
        }
        resultTokens.push([nodeType, m[0]]);
        str = str.slice(m[0].length);
        continue;
    }
    let found = false;
    // Try matching the longest strings first:
    for (let tokenStr of Object.keys(tokenTypes).sort(function(a, b){return b.length - a.length})) {
        if (str.substr(0,tokenStr.length) == tokenStr) {
            resultTokens.push([tokenTypes[tokenStr], tokenStr]);
            str = str.slice(tokenStr.length);
            found = true;
            break;
        }
    }
    if (!found) {
        console.error('Unable to tokenize "' + sourceFile + '" here:' + "\n" + str + "\n***END OF FILE***\n");
        return;
    }
}

// Verify all tokens concatted equals the original source code
let testStr = '';
for(let t of resultTokens) {
    testStr += t[1];
}
if (testStr != sourceCode.toString()) {
    throw new Error('Tokens concatted not equal to original source code');
}

// fs.writeFileSync(stateFile, JSON.stringify(tokenTypes));
fs.writeFileSync(tokensFile, JSON.stringify(resultTokens));

console.log(sourceFile + ' tokenized successfully');
