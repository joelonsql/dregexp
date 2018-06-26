/*
This script parses the ast-json format on stdin,
extracts the tokens and creates a new simpler array-of-arrays
data structure, [[tokenType, literal], ...], which is
written to stdout and also saved to [filename.rs.tokens].
*/

class rustc_ast_json{

    constructor() {}

    // AST : the output from rustc -Zast-json-noexpand [filename.rs]
    // sourceCodeString: the content of [filename.rs]
    // The -Zast-json-noexpand option is only available for the "nightly" rustc version.
    tokenize(AST, sourceCodeString) {
        this.tokens = {};
        this.lastLo = -1;
        // Attributes on the top-level don't exist in the 'tokens' array in the AST
        // and must be extracted from 'attrs' instead.
        // Keep track of the byte positons for seen idents and attribs,
        // and add tokens for attribs that don't exist in idents.
        this.idents = {};
        this.attribs = {};
        this.mods = {};
        this.sourceCodeBuffer = Buffer.from(sourceCodeString);

        // Some token types cannot be derived since they don't exist in the ast_json-data
        // and therefore need to be hard-coded manually:
        this.tokenTypes = {
            Pound: '#',
            Not: '!',
            LBrace: '{',
            RBrace: '}',
            LParen: '(',
            RParen: ')',
            LBracket: '[',
            RBracket: ']',
        };
        // Detect if there is a magic byte-order-mark sequence in the beginning of the file:
        let BOM = null;
        if (this.sourceCodeBuffer[0] == 239
            && this.sourceCodeBuffer[1] == 187
            && this.sourceCodeBuffer[2] == 191
        ) {
            // Remove byte order mark
            BOM = this.sourceCodeBuffer.slice(0,3);
            this.sourceCodeBuffer = this.sourceCodeBuffer.slice(3, this.sourceCodeBuffer.length);
        }
        this.traverse(AST);
        for (let identPos in this.attribs) {
            if (!this.idents.hasOwnProperty(identPos)) {
                if (this.attribs[identPos].style == 'Inner') {
                    // InnerAttribute
                    this._newToken('Pound', this.attribs[identPos].lo);
                    this._newToken('Not', this.attribs[identPos].lo+1);
                    this._newToken('LBracket', this.attribs[identPos].lo+2);
                } else if (this.attribs[identPos].style == 'Outer') {
                    // OuterAttribute
                    this._newToken('Pound', this.attribs[identPos].lo);
                    this._newToken('LBracket', this.attribs[identPos].lo+1);
                } else {
                    throw new Error('Unknown attribute style: ' + this.attribs[identPos].style);
                }
                this._newToken('RBracket', this.attribs[identPos].hi-1);
            }
        }
        for (let modPos in this.mods) {
            if (!this.idents.hasOwnProperty(modPos)) {
                let modPosOffset = parseInt(modPos);
                if (this.mods[modPos].pub) {
                    this.tokens[modPosOffset] = ['Ident', 'pub']; modPosOffset += 3+1;
                }
                this.tokens[modPosOffset] = ['Ident', 'mod']; modPosOffset += 3+1;
                this.tokens[modPosOffset] = ['Ident', this.mods[modPos].ident]; modPosOffset += this.mods[modPos].ident.length + 1;
                this.tokens[modPosOffset] = ['LBrace', '{']; modPosOffset += 1;
                this.tokens[this.mods[modPos].hi*1-1] = ['RBrace', '}'];
            }
        }
        let sortedTokens = [];
        for(let lo of Object.keys(this.tokens).sort(function(a, b){return a - b})) {
            sortedTokens.push(this.tokens[lo]);
        }
        return sortedTokens;
    }

    _newToken(tokenType, tokenBytePos, tokenStr = null) {
        if (tokenStr == null) {
            if (this.tokenTypes.hasOwnProperty(tokenType)) {
                tokenStr = this.tokenTypes[tokenType];
            } else {
                throw new Error('No hard-coded string for tokenType ' + tokenType);
            }
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
        if (this.tokens.hasOwnProperty(tokenBytePos)) {
            // duplicate token, skip
            return;
        }
        this.tokens[tokenBytePos] = [tokenType, tokenStr];
    }

    newToken(tokenType, hiLo) {
        if (tokenType == null || hiLo == null) {
            throw new Error('Invalid arguments');
        } else if (tokenType == 'Eq' && (hiLo.hi - hiLo.lo) > 1) {
            return;
        } else if (hiLo.hi > this.sourceCodeBuffer.length) {
            console.error('skipped (insane ast-json data, byte position exceeds file size)');
            process.exit(1);
        }
        let tokenStr = this.sourceCodeBuffer.toString('utf8', hiLo.lo, hiLo.hi);
        this._newToken(tokenType, hiLo.lo, tokenStr);
    }

    traverse(AST, path = '') {
        if (!AST) {
            return null;
        }
        if (AST.constructor === Array) {
            let i = 0;
            for (let element of AST) {
                this.traverse(element, path + '[' + i + ']');
                i++;
            }
        } else if (AST.constructor === Object) {
            if (AST.node && AST.node && AST.node.variant == 'Mod' && AST.ident != '' && AST.span) {
                this.mods[AST.span.lo] = {ident: AST.ident, hi: AST.span.hi, pub: AST.vis.node == 'Public' };
            }
            if (AST.variant == 'Token' && typeof AST.fields[1] === 'string') {
                this.newToken(AST.fields[1], AST.fields[0]);
            } else if (AST.variant == 'Token'
                && AST.fields
                && AST.fields[1].variant
                && AST.fields[1].variant == 'Ident'
                && AST.fields[1].fields
            ) {
                this.idents[AST.fields[0].lo] = AST.fields[1].fields[0];
                this.newToken(AST.fields[1].variant, AST.fields[0]);
            } else if (AST.variant == 'Token'
                && AST.fields
                && AST.fields[1].variant
                && AST.fields[1].variant == 'Lifetime'
                && AST.fields[1].fields
            ) {
                this.newToken(AST.fields[1].variant, AST.fields[0]);
            } else if (AST.variant == 'Token'
                && AST.fields
                && AST.fields[1].variant
                && AST.fields[1].variant == 'DocComment'
                && AST.fields[1].fields
            ) {
                this.newToken(AST.fields[1].variant, AST.fields[0]);
            } else if (AST.variant == 'Token'
                && AST.fields
                && AST.fields[1].variant
                && AST.fields[1].variant == 'BinOp'
                && AST.fields[1].fields
            ) {
                this.newToken(AST.fields[1].fields[0], AST.fields[0]);
            } else if (AST.variant == 'Token'
                && AST.fields
                && AST.fields[1].variant
                && AST.fields[1].variant == 'BinOpEq'
                && AST.fields[1].fields
            ) {
                this.newToken(AST.fields[1].fields[0] + 'Eq', AST.fields[0]);
            } else if (AST.variant == 'Token'
                && AST.fields
                && AST.fields[1].variant
                && AST.fields[1].variant == 'Literal'
                && AST.fields[1].fields
                && AST.fields[1].fields[0]
                && AST.fields[1].fields[0].variant
                && AST.fields[1].fields[0].fields
            ) {
                this.newToken(AST.fields[1].fields[0].variant, AST.fields[0]);
            } else if (AST.variant == 'Delimited'
                && AST.fields
                && AST.fields[1].delim
                && AST.fields[1].tts
            ) {
                this._newToken('L' + AST.fields[1].delim, AST.fields[0].lo);
                this.traverse(AST.fields[1].tts, path + '[tts]');
                this._newToken('R' + AST.fields[1].delim, AST.fields[0].hi-1);
            } else if (AST.path
                && AST.path.span
                && AST.path.segments
                && AST.path.segments[0]
                && AST.path.segments[0].ident
                && AST.style
                && AST.tokens
            ) {
                if (!AST.is_sugared_doc) {
                    this.attribs[AST.path.span.lo] = {style: AST.style, lo: AST.span.lo, hi: AST.span.hi};
                    this.newToken('Ident', AST.path.span);
                }
                this.traverse(AST.tokens, path + '[tokens]');
            } else if (AST.variant == 'Token') {
                console.log('Cannot handle: ' + JSON.stringify(AST));
            } else {
                for (let key of Object.keys(AST).sort()) {
                    this.traverse(AST[key], path + '[' + key + ']');
                }
            }
        }
    }
}

module.exports = rustc_ast_json;
