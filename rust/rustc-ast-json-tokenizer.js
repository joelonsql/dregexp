#!/usr/local/bin/node
/*
This script parses the ast-json format on stdin,
extracts the tokens and creates a new simpler array-of-arrays
data structure, [[tokenType, literal], ...], which is
written to stdout and also saved to [filename.rs.tokens].
*/

const { execSync } = require('child_process');

let fs = require('fs');

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
    'Pound' : '#',
    'Not' : '!',
    'LBrace' : '{',
    'RBrace' : '}',
    'LParen' : '(',
    'RParen' : ')',
    'LBracket' : '[',
    'RBracket' : ']',
};

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

let tokens = {};
let lastLo = -1;

function newToken(tokenType, path, hiLo, pos) {
//    console.log(JSON.stringify({'tokenType':tokenType, 'path':path, 'hiLo':hiLo, 'pos':pos}));
    if (tokenType == null) {
        throw new Error('Invalid arguments');
    }
    let tokenStr;
    let thisLo = null;
    if (pos != null) {
        if (!tokenTypes.hasOwnProperty(tokenType)) {
            throw new Error('No hard-coded string for tokenType ' + tokenType + ' ' + pos);
        }
        tokenStr = tokenTypes[tokenType];
        thisLo = pos;
        lastLo = thisLo;
    } else if (hiLo) {
        if (tokenType == 'Eq' && (hiLo.hi - hiLo.lo) > 1) {
            return false;
        }
        if (hiLo.hi > sourceCode.length) {
            console.error('Cannot process "' + sourceFile +
                '", insane ast-json data, byte position hiLo.hi (' + hiLo.hi +
                ') exceeds file size (' + sourceCode.length + ')');
            process.exit(1);
        }
        tokenStr = sourceCode.toString('utf8', hiLo.lo, hiLo.hi);
        thisLo = hiLo.lo;
        lastLo = hiLo.lo;
    } else {
        if (!tokenTypes.hasOwnProperty(tokenType)) {
            throw new Error('No hard-coded string for tokenType ' + tokenType);
        }
        tokenStr = tokenTypes[tokenType];
        thisLo = lastLo+1;
        lastLo = thisLo;
    }
    // Need to match for doc comments
    if (tokenType == 'Str_') {
        let docComment = tokenStr.match(/^(?:(\/\/!.*)|(\/\*![\s\S]*?\*\/)|(\/\/\/(?!\/).*)|(\/\*\*(?!\*)[\s\S]*?\*\/))/);
        if (docComment) {
            if (docComment[1]) {
                tokenType = 'InnerLineDocComment';
            } else if (docComment[2]) {
                tokenType = 'InnerBlockDocComment';
            } else if (docComment[3]) {
                tokenType = 'DocComment';
            } else if (docComment[4]) {
                tokenType = 'OuterBlockDocComment';
            }
        }
    }
    if (tokens.hasOwnProperty(thisLo)) {
        // duplicate token, skip
        return false;
    }
    tokens[thisLo] = [tokenType, tokenStr];
    return true;
}

// Attributes on the top-level don't exist in the 'tokens' array in the AST
// and must be extracted from 'attrs' instead.
// Keep track of the byte positons for seen idents and attributes,
// and add tokens for attributes that don't exist in idents.
let idents = {};
let attributes = {};
let mods = {};

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
        if (AST.node && AST.node && AST.node.variant == 'Mod' && AST.ident != '' && AST.span) {
            mods[AST.span.lo] = {'ident': AST.ident, 'hi': AST.span.hi};
        }

        if (AST.variant == 'Token' && typeof AST.fields[1] === 'string') {
            newToken(AST.fields[1], path, AST.fields[0]);
        } else if (AST.variant == 'Token'
            && AST.fields
            && AST.fields[1].variant
            && AST.fields[1].variant == 'Ident'
            && AST.fields[1].fields
        ) {
            idents[AST.fields[0].lo] = AST.fields[1].fields[0];
            newToken(AST.fields[1].variant, path, AST.fields[0]);
        } else if (AST.variant == 'Token'
            && AST.fields
            && AST.fields[1].variant
            && AST.fields[1].variant == 'Lifetime'
            && AST.fields[1].fields
        ) {
            newToken(AST.fields[1].variant, path, AST.fields[0]);
        } else if (AST.variant == 'Token'
            && AST.fields
            && AST.fields[1].variant
            && AST.fields[1].variant == 'DocComment'
            && AST.fields[1].fields
        ) {
            newToken(AST.fields[1].variant, path, AST.fields[0]);
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
            newToken(AST.fields[1].fields[0].variant, path, AST.fields[0]);
        } else if (AST.variant == 'Delimited'
            && AST.fields
            && AST.fields[1].delim
            && AST.fields[1].tts
        ) {
            newToken('L' + AST.fields[1].delim, path, null, AST.fields[0].lo);
            traverse(AST.fields[1].tts, path + '[tts]');
            newToken('R' + AST.fields[1].delim, path, null, AST.fields[0].hi-1);
//        } else if (AST.path
//            && AST.path.segments
//            && AST.path.segments[0]
//            && AST.path.segments[0].ident == 'doc'
//            && AST.tokens
//        ) {
//            traverse(AST.tokens, path + '[tokens]');
        } else if (AST.path
            && AST.path.span
            && AST.path.segments
            && AST.path.segments[0]
            && AST.path.segments[0].ident
            && AST.style
            && AST.tokens
        ) {
//            console.log(JSON.stringify(AST,null,4));
            if (!AST.is_sugared_doc) {
                attributes[AST.path.span.lo] = {'style': AST.style, 'lo': AST.span.lo, 'hi': AST.span.hi};
                newToken('Ident', path, AST.path.span);
            }
            traverse(AST.tokens, path + '[tokens]');
        } else if (AST.variant == 'Token') {
            console.log('Cannot handle: ' + JSON.stringify(AST));
        } else {
            for (let key of Object.keys(AST).sort()) {
                traverse(AST[key], path + '[' + key + ']');
            }
        }
    }
}

traverse(AST);

// console.log(JSON.stringify(mods));
// console.log(JSON.stringify(attributes,null,4));
// console.log(JSON.stringify(idents,null,4));
// console.log(JSON.stringify(tokens));

for (let identPos in attributes) {
    if (!idents.hasOwnProperty(identPos)) {
//        console.log('Adding #[], ident pos ' + identPos);
        if (attributes[identPos].style == 'Inner') {
            // InnerAttribute
            newToken('Pound', null, null, attributes[identPos].lo);
            newToken('Not', null, null, attributes[identPos].lo+1);
            newToken('LBracket', null, null, attributes[identPos].lo+2);
        } else if (attributes[identPos].style == 'Outer') {
            // OuterAttribute
            newToken('Pound', null, null, attributes[identPos].lo);
            newToken('LBracket', null, null, attributes[identPos].lo+1);
        } else {
            throw new Error('Unknown attribute style: ' + attributes[identPos].style);
        }
        newToken('RBracket', null, null, attributes[identPos].hi-1);
    }
}

// console.log(JSON.stringify(tokens));

for (let modPos in mods) {
    if (!idents.hasOwnProperty(modPos)) {
        tokens[modPos] = ['Ident', 'mod'];
        tokens[modPos*1+5] = ['Ident', mods[modPos].ident];
        tokens[modPos*1+6] = ['LBrace', '{'];
        tokens[mods[modPos].hi*1-1] = ['RBrace', '}'];
    }
}

// console.log(JSON.stringify(tokens));

// console.log(JSON.stringify(tokens));

let sortedTokens = [];
for(let lo of Object.keys(tokens).sort(function(a, b){return a - b})) {
    sortedTokens.push(tokens[lo]);
}

fs.writeFileSync(tokensFile, JSON.stringify(sortedTokens));

console.log(sourceFile + ' tokenized successfully');
