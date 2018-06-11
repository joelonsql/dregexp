'use strict';

function DRegExp(grammarRules) {
    this.nodeTypes = [];
    this.nodeTypeIds = {};
    this.tokenizePatterns = {};
    this.parsePatterns = {};
    this.expandedTokenizePatterns = {};
    this.expandedParsePatterns = {};
    this.tokenNodeTypes = [];
    this.parserNodeTypes = [];
    this.nodeId = 0;
    this.nodes = [];
    this.firstNodeTypeCharCode = 44032; // Unbroken sequence of >10000 ideograms starting at this unicode char code
    this.tokenizerCaptureGroupsRegexp = null;

    // Load grammar rules
    let nodeTypeId = 0;
    for (let rule of grammarRules) {
        if (this.nodeTypes.includes(rule.nodetype)) {
            console.error(rule.nodetype + ': defined more than once');
            return null;
        } else if (!rule.nodetype.match(/^[A-Za-z_]{2,}$/)) {
            console.error(rule.nodetype + ': invalid format');
            return null;
        } else {
            this.nodeTypes.push(rule.nodetype);
            this.nodeTypeIds[rule.nodetype] = nodeTypeId++;
        }

        if (rule.charpattern.length > 0 && rule.nodepattern.length > 0) {
            console.error(rule.nodetype + ': only one of charpattern or nodepattern must be defined, not both');
            return null;
        } else if (rule.charpattern.length > 0) {
            this.tokenizePatterns[rule.nodetype] = rule.charpattern;
        } else if (rule.nodepattern.length > 0) {
            if (rule.nodepattern.match(/\\/)) {
                console.error(rule.nodetype + ': nodepattern must not contain backslashes (\\)');
                return null;
            }
            this.parsePatterns[rule.nodetype] = rule.nodepattern;
        } else {
            console.error(rule.nodetype + ': charpattern or nodepattern must be defined');
            return null;
        }
    }

    // Expand char patterns in node patterns
    for (let nodeType in this.parsePatterns) {
        let matchNodeTypes = this.parsePatterns[nodeType].match(/[A-Za-z_]{2,}/g);
        for (let subNodeType of matchNodeTypes) {
            if (this.tokenizePatterns[subNodeType] && !this.expandedTokenizePatterns[subNodeType]) {
                this.expandedTokenizePatterns[subNodeType] = this.expandTokenizePattern(subNodeType);
            }
        }
    }

    // Build tokenizer regexp, one capture group per token node type
    let tokenRegexes = [];
    for (let nodeType of this.nodeTypes) {
        if (!this.expandedTokenizePatterns[nodeType]) {
            continue;
        }
        this.tokenNodeTypes.push(nodeType);
        tokenRegexes.push(this.expandedTokenizePatterns[nodeType]);
    }
    this.tokenizerCaptureGroupsRegexp = new RegExp('^(?:(' + tokenRegexes.join(')|(') + '))');
    console.log('tokenizerCaptureGroupsRegexp: ' + this.tokenizerCaptureGroupsRegexp);

    // Expand node patterns
    for (let nodeType of this.nodeTypes) {
        if (!this.parsePatterns[nodeType]) {
            continue;
        }
        this.parserNodeTypes.push(nodeType);
        this.expandedParsePatterns[nodeType] = new RegExp(this.expandParsePattern(nodeType));
    }

}

DRegExp.prototype.constructor = DRegExp;

DRegExp.prototype.encodeNodeType = function(nodeType) {
    return String.fromCharCode(this.firstNodeTypeCharCode + this.nodeTypeIds[nodeType]);
}

DRegExp.prototype.decodeNodeType = function(unicodeToken) {
    return this.nodeTypes[unicodeToken.charCodeAt(0) - this.firstNodeTypeCharCode];
}

DRegExp.prototype.tokenize = function(inputString) {
    let nodeString = '';
    while (inputString.length > 0) {
        let m = inputString.match(this.tokenizerCaptureGroupsRegexp);
        if (m == null) {
            console.error('unable to tokenize: ' + inputString);
            return null;
        }
        let matched = false;
        for (let i=0; i < this.tokenNodeTypes.length; i++) {
            if (m[i+1] == null) {
                continue;
            } else if (matched) {
                console.error('multiple capture groups matched: ' + this.tokenNodeTypes[i]);
                return null;
            }
            matched = true;
            console.log(this.tokenNodeTypes[i] +  " " + m[i+1]);
            this.nodes[this.nodeId] = [this.tokenNodeTypes[i], m[i+1]];
            nodeString += this.encodeNodeType(this.tokenNodeTypes[i]) + this.nodeId++ + ',';
            inputString = inputString.slice(m[i+1].length);
        }
    }
    return nodeString;
}

DRegExp.prototype.parse = function(nodeString) {
    for (let didWork = true; didWork; ) {
        didWork = false;
        for (let nodeType of this.parserNodeTypes) {
            let m = nodeString.match(this.expandedParsePatterns[nodeType]);
            if (m == null) {
                continue;
            } else if (m.length != 2) { // 2 means 1 capture group, since m[0] is whole match, and m[1] the first capture group, i.e. 2 array elements
                console.error('multiple capture groups matched: nodeString: ' + nodeString + ' expandedParsePattern: ' + this.expandedParsePatterns[nodeType]);
                return false;
            }
            let subNodeString = m[1];
            nodeString = nodeString.replace(subNodeString, this.encodeNodeType(nodeType) + this.nodeId + ',');
            let subNodes = [];
            while (subNodeString.length > 0) {
                let subNode = subNodeString.match(/([가-판])(\d+),/u); // [가-판] is the 10000 unicode chars between this.firstNodeTypeCharCode=44032..54032
                if (subNode == null) {
                    console.error('unable to parse: ' + subNodeString);
                    return false;
                }
                let subNodeType = this.decodeNodeType(subNode[1]);
                let subNodeId = subNode[2];
                subNodes.push(this.nodes[subNodeId]);
                subNodeString = subNodeString.replace(subNode[0], '');
                console.log(subNodeType + subNodeId + ' -> ' + nodeType + this.nodeId);
            }
            this.nodes[this.nodeId++] = [nodeType, subNodes];
            didWork = true;
            break;
        }
    }
    this.nodeId--;
    let finalNodeType = this.nodeTypes[this.nodeTypes.length - 1];
    if (nodeString.match(new RegExp('^' + this.encodeNodeType(finalNodeType) + this.nodeId + ',$')) == null) {
        console.error('Parser error, no parsePattern matches remaining nodeString: ' + nodeString);
        return null;
    }
    return this.nodes[this.nodeId]; // parseTree
}

DRegExp.prototype.expandTokenizePattern = function(nodeType) {
    let tokenizePattern = this.tokenizePatterns[nodeType];
    let matchNodeTypes = tokenizePattern.match(/[A-Za-z_]{2,}/g) || [];
    for (let subNodeType of matchNodeTypes) {
        tokenizePattern = tokenizePattern.replace(new RegExp(subNodeType, 'g'), this.expandTokenizePattern(subNodeType));
    }
    tokenizePattern = tokenizePattern.replace(/\s+/g, '');
    return tokenizePattern;
}

DRegExp.prototype.expandParsePattern = function(nodeType) {
    let parsePattern = this.parsePatterns[nodeType];
    let bracketExpressions = parsePattern.match(/\[[A-Za-z_]{2,}(?:\s+[A-Za-z_]{2,})*\]/g) || [];
    for (let bracketExpression of bracketExpressions) {
        let expandedBracketExpression = '';
        let bracketNodeTypes = bracketExpression.match(/[A-Za-z_]{2,}/g);
        for (let bracketNodeType of bracketNodeTypes) {
            expandedBracketExpression += this.encodeNodeType(bracketNodeType);
        }
        parsePattern = parsePattern.replace(bracketExpression, '[' + expandedBracketExpression + ']\\d+,')
    }
    let subNodeTypes = parsePattern.match(/[A-Za-z_]{2,}/g) || [];
    for (let subNodeType of subNodeTypes) {
        parsePattern = parsePattern.replace(subNodeType, '(?:' + this.encodeNodeType(subNodeType) + '\\d+,)');
    }
    parsePattern = parsePattern.replace(/\s+/g, '');
    return parsePattern;
}