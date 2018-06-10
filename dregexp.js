'use strict';

function DRegExp(grammarRules) {
    this.nodeTypes = [];
    this.nodeTypeIds = {};
    this.charPatterns = {};
    this.nodePatterns = {};
    this.expandedCharPatterns = {};
    this.expandedNodePatterns = {};
    this.nodeId = 0;
    this.nodes = [];
    this.firstNodeTypeCharCode = 44032; // Unbroken sequence of >10000 ideograms starting at this unicode char code

    // Load grammar rules
    let nodeTypeId = 0;
    for (let rule of grammarRules) {
        if (this.nodeTypes.includes(rule.nodetype)) {
            console.error('nodeType ' + rule.nodetype + ': defined more than once');
            return null;
        } else if (!rule.nodetype.match(/^[A-Za-z_]+$/)) {
            console.error('nodeType ' + rule.nodetype + ': contains invalid characters');
            return null;
        } else {
            this.nodeTypes.push(rule.nodetype);
            this.nodeTypeIds[rule.nodetype] = nodeTypeId;
            nodeTypeId++;
        }

        if (rule.charpattern.length > 0 && rule.nodepattern.length > 0) {
            console.error('nodeType ' + rule.nodetype + ': only one of charpattern or nodepattern must be defined, not both');
            return null;
        } else if (rule.charpattern.length > 0) {
            this.charPatterns[rule.nodetype] = rule.charpattern;
        } else if (rule.nodepattern.length > 0) {
            if (rule.nodepattern.match(/\\/)) {
                console.error('nodeType ' + rule.nodetype + ': nodepattern must not contain backslashes (\\)');
                return null;
            }
            this.nodePatterns[rule.nodetype] = rule.nodepattern;
        } else {
            console.error('nodeType ' + rule.nodetype + ': charpattern or nodepattern must be defined');
            return null;
        }
    }
}

DRegExp.prototype.constructor = DRegExp;

DRegExp.prototype.tokenize = function(inputString) {
    // Expand char patterns
    for (let nodeType in this.nodePatterns) {
        let matchNodeTypes = this.nodePatterns[nodeType].match(/[A-Za-z_]{2,}/g);
        for (let subNodeType of matchNodeTypes) {
            if (this.charPatterns[subNodeType] && !this.expandedCharPatterns[subNodeType]) {
                this.expandedCharPatterns[subNodeType] = this.expandCharPattern(subNodeType);
            }
        }
    }

    // Build tokenizer regexp, one capture group per token node type
    let tokenNodeTypes = [];
    let tokenRegexes = [];
    for (let nodeType of this.nodeTypes) {
        if (!this.expandedCharPatterns[nodeType]) {
            continue;
        }
        tokenNodeTypes.push(nodeType);
        tokenRegexes.push(this.expandedCharPatterns[nodeType]);
    }
    let tokenizerCaptureGroupsRegexp = new RegExp('^(?:(' + tokenRegexes.join(')|(') + '))');
    console.log('tokenizerCaptureGroupsRegexp: ' + tokenizerCaptureGroupsRegexp);

    // Build nodeString
    let nodeString = '';
    while (inputString.length > 0) {
        let m = inputString.match(tokenizerCaptureGroupsRegexp);
        if (m == null) {
            console.error('unable to tokenize: ' + inputString);
            return null;
        }
        let matched = false;
        for (let i=0; i < tokenNodeTypes.length; i++) {
            if (m[i+1] != null) {
                if (matched) {
                    console.error('multiple capture groups matched: ' + tokenNodeTypes[i]);
                    return null;
                }
                console.log(tokenNodeTypes[i] +  " " + m[i+1]);
                this.nodes[this.nodeId] = [tokenNodeTypes[i], m[i+1]];
                nodeString += String.fromCharCode(this.firstNodeTypeCharCode + this.nodeTypeIds[tokenNodeTypes[i]]) + this.nodeId + ',';
                this.nodeId++;
                matched = true;
                inputString = inputString.slice(m[i+1].length);
            }
        }
    }

    return nodeString;
}

DRegExp.prototype.parse = function(nodeString) {
    // Expand node patterns
    let parserNodeTypes = [];
    for (let nodeType of this.nodeTypes) {
        if (!this.nodePatterns[nodeType]) {
            continue;
        }
        parserNodeTypes.push(nodeType);
        this.expandedNodePatterns[nodeType] = this.expandNodePattern(nodeType);
    }

    // Parse node string against node patterns
    for (let didWork = true; didWork; ) {
        didWork = false;
        for (let nodeType of parserNodeTypes) {
            let m = nodeString.match(new RegExp(this.expandedNodePatterns[nodeType]));
            if (m == null) {
                continue;
            } else if (m.length != 2) { // 2 means 1 capture group, since m[0] is whole match, and m[1] the first capture group, i.e. 2 array elements
                console.error('multiple capture groups matched: nodeString: ' + nodeString + ' expandedNodePattern: ' + this.expandedNodePatterns[nodeType]);
                return false;
            }
            let subNodeString = m[1];
            nodeString = nodeString.replace(subNodeString, String.fromCharCode(this.firstNodeTypeCharCode + this.nodeTypeIds[nodeType]) + this.nodeId + ',');
            let subNodes = [];
            while (subNodeString.length > 0) {
                let subNode = subNodeString.match(/([가-판])(\d+),/u); // [가-판] is the 10000 unicode chars between 44032..54032
                if (subNode == null) {
                    console.error('unable to parse: ' + subNodeString);
                    return false;
                }
                let subNodeType = this.nodeTypes[subNode[1].charCodeAt(0) - this.firstNodeTypeCharCode];
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
    this.nodeId--; // to get nodeId for final node

    if (nodeString.match(new RegExp('^' + String.fromCharCode(this.firstNodeTypeCharCode + this.nodeTypes.length - 1) + this.nodeId + ',$')) == null) {
        console.error('Parser error, expected final single node to be of nodeType ' + this.nodeTypes[this.nodeTypes.length - 1]);
        return null;
    }

    console.log('OK, final single node is of nodeType ' + this.nodeTypes[this.nodeTypes.length - 1]);

    return this.nodes[this.nodeId];
}

DRegExp.prototype.expandCharPattern = function(nodeType) {
    let charPattern = this.charPatterns[nodeType];
    let matchNodeTypes = charPattern.match(/[A-Za-z_]{2,}/g);
    if (matchNodeTypes) {
        for (let subNodeType of matchNodeTypes) {
            charPattern = charPattern.replace(new RegExp(subNodeType, 'g'), this.expandCharPattern(subNodeType));
        }
    }
    charPattern = charPattern.replace(/\s+/g, '');
    return charPattern;
}

DRegExp.prototype.expandNodePattern = function(nodeType) {
    let nodePattern = this.nodePatterns[nodeType];
    let bracketExpressions = nodePattern.match(/\[[A-Za-z_]{2,}(?:\s+[A-Za-z_]{2,})*\]/g);
    if (bracketExpressions) {
        for (let bracketExpression of bracketExpressions) {
            let expandedBracketExpression = '';
            let bracketNodeTypes = bracketExpression.match(/[A-Za-z_]{2,}/g);
            for (let bracketNodeType of bracketNodeTypes) {
                expandedBracketExpression += String.fromCharCode(this.firstNodeTypeCharCode + this.nodeTypeIds[bracketNodeType]);
            }
            nodePattern = nodePattern.replace(bracketExpression, '[' + expandedBracketExpression + ']\\d+,')
        }
    }
    let subNodeTypes = nodePattern.match(/[A-Za-z_]{2,}/g);
    if (subNodeTypes) {
        for (let subNodeType of subNodeTypes) {
            nodePattern = nodePattern.replace(subNodeType, '(?:' + String.fromCharCode(this.firstNodeTypeCharCode + this.nodeTypeIds[subNodeType]) + '\\d+,)');
        }
    }
    nodePattern = nodePattern.replace(/\s+/g, '');
    return nodePattern;
}

