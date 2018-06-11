'use strict';

function DRegExp(grammarRules) {
    this.nodeTypes = [];
    this.nodeTypeIds = {};
    this.charPatterns = {};
    this.nodePatterns = {};
    this.expandedCharPatterns = {};
    this.expandedNodePatterns = {};
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
            this.nodeTypeIds[rule.nodetype] = nodeTypeId;
            nodeTypeId++;
        }

        if (rule.charpattern.length > 0 && rule.nodepattern.length > 0) {
            console.error(rule.nodetype + ': only one of charpattern or nodepattern must be defined, not both');
            return null;
        } else if (rule.charpattern.length > 0) {
            this.charPatterns[rule.nodetype] = rule.charpattern;
        } else if (rule.nodepattern.length > 0) {
            if (rule.nodepattern.match(/\\/)) {
                console.error(rule.nodetype + ': nodepattern must not contain backslashes (\\)');
                return null;
            }
            this.nodePatterns[rule.nodetype] = rule.nodepattern;
        } else {
            console.error(rule.nodetype + ': charpattern or nodepattern must be defined');
            return null;
        }
    }

    // Expand char patterns in node patterns
    for (let nodeType in this.nodePatterns) {
        let matchNodeTypes = this.nodePatterns[nodeType].match(/[A-Za-z_]{2,}/g);
        for (let subNodeType of matchNodeTypes) {
            if (this.charPatterns[subNodeType] && !this.expandedCharPatterns[subNodeType]) {
                this.expandedCharPatterns[subNodeType] = this.expandCharPattern(subNodeType);
            }
        }
    }

    // Build tokenizer regexp, one capture group per token node type
    let tokenRegexes = [];
    for (let nodeType of this.nodeTypes) {
        if (!this.expandedCharPatterns[nodeType]) {
            continue;
        }
        this.tokenNodeTypes.push(nodeType);
        tokenRegexes.push(this.expandedCharPatterns[nodeType]);
    }
    this.tokenizerCaptureGroupsRegexp = new RegExp('^(?:(' + tokenRegexes.join(')|(') + '))');
    console.log('tokenizerCaptureGroupsRegexp: ' + this.tokenizerCaptureGroupsRegexp);

    // Expand node patterns
    for (let nodeType of this.nodeTypes) {
        if (!this.nodePatterns[nodeType]) {
            continue;
        }
        this.parserNodeTypes.push(nodeType);
        this.expandedNodePatterns[nodeType] = new RegExp(this.expandNodePattern(nodeType));
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
            nodeString += this.encodeNodeType(this.tokenNodeTypes[i]) + this.nodeId + ',';
            this.nodeId++;
            inputString = inputString.slice(m[i+1].length);
        }
    }
    return nodeString;
}

DRegExp.prototype.parse = function(nodeString) {
    for (let didWork = true; didWork; ) {
        didWork = false;
        for (let nodeType of this.parserNodeTypes) {
            let m = nodeString.match(this.expandedNodePatterns[nodeType]);
            if (m == null) {
                continue;
            } else if (m.length != 2) { // 2 means 1 capture group, since m[0] is whole match, and m[1] the first capture group, i.e. 2 array elements
                console.error('multiple capture groups matched: nodeString: ' + nodeString + ' expandedNodePattern: ' + this.expandedNodePatterns[nodeType]);
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
            this.nodes[this.nodeId] = [nodeType, subNodes];
            this.nodeId++;
            didWork = true;
            break;
        }
    }
    this.nodeId--;
    let finalNodeType = this.nodeTypes[this.nodeTypes.length - 1];
    if (nodeString.match(new RegExp('^' + this.encodeNodeType(finalNodeType) + this.nodeId + ',$')) == null) {
        console.error('Parser error, no nodePattern matches remaining nodeString: ' + nodeString);
        return null;
    }
    return this.nodes[this.nodeId]; // parseTree
}

DRegExp.prototype.expandCharPattern = function(nodeType) {
    let charPattern = this.charPatterns[nodeType];
    let matchNodeTypes = charPattern.match(/[A-Za-z_]{2,}/g) || [];
    for (let subNodeType of matchNodeTypes) {
        charPattern = charPattern.replace(new RegExp(subNodeType, 'g'), this.expandCharPattern(subNodeType));
    }
    charPattern = charPattern.replace(/\s+/g, '');
    return charPattern;
}

DRegExp.prototype.expandNodePattern = function(nodeType) {
    let nodePattern = this.nodePatterns[nodeType];
    let bracketExpressions = nodePattern.match(/\[[A-Za-z_]{2,}(?:\s+[A-Za-z_]{2,})*\]/g) || [];
    for (let bracketExpression of bracketExpressions) {
        let expandedBracketExpression = '';
        let bracketNodeTypes = bracketExpression.match(/[A-Za-z_]{2,}/g);
        for (let bracketNodeType of bracketNodeTypes) {
            expandedBracketExpression += this.encodeNodeType(bracketNodeType);
        }
        nodePattern = nodePattern.replace(bracketExpression, '[' + expandedBracketExpression + ']\\d+,')
    }
    let subNodeTypes = nodePattern.match(/[A-Za-z_]{2,}/g) || [];
    for (let subNodeType of subNodeTypes) {
        nodePattern = nodePattern.replace(subNodeType, '(?:' + this.encodeNodeType(subNodeType) + '\\d+,)');
    }
    nodePattern = nodePattern.replace(/\s+/g, '');
    return nodePattern;
}