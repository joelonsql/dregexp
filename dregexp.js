class DRegExp {

    constructor(flags = {}) {
        this.nodeTypes = ['?']; // the first nodeType is a special one for unrecognized characters
        this.nodeTypeIds = {'?':0};
        this.firstNodeTypeCharCode = 44032; // Unbroken sequence of >10000 ideograms starting at this unicode char code
        this.nodeGroups = {};
        this.grammarRules = {};
        this.tokenizerNodeTypes = [];
        this.parserNodeTypes = {};
        this.flags = flags;
        this.mainParser = null;
    }

    loadGrammarRules(csvInputArrayOfHashes) {
        let nodeTypeId = this.nodeTypes.length;
        for (let rule of csvInputArrayOfHashes) {
            let parser = rule.parser;
            if (!parser) {
                // skip empty lines
                continue;
            } else if (this.mainParser == null) {
                this.mainParser = parser;
            }
            let nodeType = this.validateName(rule.nodetype);
            if (this.nodeGroups.hasOwnProperty(nodeType)) {
                throw new Error('nodeType ' + nodeType + ' is already declared as a nodeGroup');
            }
            if (this.grammarRules.hasOwnProperty(nodeType)) {
                throw new Error('duplicate nodeType: ' + nodeType);
            }
            this.grammarRules[nodeType] = rule;
            this.nodeTypes.push(nodeType);
            this.nodeTypeIds[nodeType] = nodeTypeId++;
            if (rule.nodegroup) {
                let nodeGroup = this.validateName(rule.nodegroup);
                if (this.grammarRules.hasOwnProperty(nodeGroup)) {
                    throw new Error('nodeGroup ' + nodeGroup + ' is already declared as a nodeType');
                }
                if (!this.nodeGroups.hasOwnProperty(nodeGroup)) {
                    this.nodeGroups[nodeGroup] = [];
                }
                this.nodeGroups[nodeGroup].push(nodeType);
            }
        }
        this.processGrammarRules();
    }

    processGrammarRules() {
        this.tokenizerNodeTypes = {};
        this.parserNodeTypes = {};
        let tokenizerNodeTypes = {};
        let allTokenizeNodeTypes = [];
        let tokenizeSubNodeTypes = [];
        let parseSubNodeTypes = [];
        let prevPrecedence = null;
        for (let nodeType of this.nodeTypes) {
            if (nodeType == '?') {
                continue;
            }
            let rule = this.grammarRules[nodeType];
            let parser = rule.parser;
            if (!parser) {
                throw new Error('parser undefined');
            }
            if (rule.tokenizepattern && !rule.parsepattern) {
                allTokenizeNodeTypes.push(nodeType);
                tokenizeSubNodeTypes = this.extractNodeTypes(tokenizeSubNodeTypes, rule.tokenizepattern);
                if (!tokenizerNodeTypes.hasOwnProperty(parser)) {
                    tokenizerNodeTypes[parser] = [];
                }
            } else if (!rule.tokenizepattern && rule.parsepattern) {
                if (!this.parserNodeTypes.hasOwnProperty(parser)) {
                    this.parserNodeTypes[parser] = [];
                }
                if (prevPrecedence && prevPrecedence == rule.precedence) {
                    this.parserNodeTypes[parser][this.parserNodeTypes[parser].length - 1].nodeTypes.push(nodeType);
                } else {
                    this.parserNodeTypes[parser].push({percedence: rule.precedence, nodeTypes: [nodeType]});
                    prevPrecedence = rule.precedence;
                }
                parseSubNodeTypes = this.extractNodeTypes(parseSubNodeTypes, rule.parsepattern);
            } else  {
                throw new Error('invalid grammar rule: ' + JSON.stringify(rule,null,4));
            }
        }

        if (parseSubNodeTypes.length > 0) {
            // Filter out node types that don't appear in any parse pattern.
            for (let nodeType of allTokenizeNodeTypes) {
                let parser = this.grammarRules[nodeType].parser;
                if (parseSubNodeTypes.includes(nodeType)) {
                    tokenizerNodeTypes[parser].push(nodeType);
                } else if (!tokenizeSubNodeTypes.includes(nodeType)) {
                    console.warn('unused nodeType: ' + nodeType);
                }
            }
        } else {
            // Filter out node types that appear in tokenize patterns,
            // as such node types are only regexp "fragments".
            for (let nodeType of allTokenizeNodeTypes) {
                let parser = this.grammarRules[nodeType].parser;
                if (!tokenizeSubNodeTypes.includes(nodeType)) {
                    tokenizerNodeTypes[parser].push(nodeType);
                }
            }
        }
        this.tokenizerNodeTypes = tokenizerNodeTypes;
    }

    extractNodeTypes(nodeTypes, patternString) {
        let matchNodeTypes = patternString.match(/[A-Za-z_]{2,}/g) || [];
        for (let subNodeType of matchNodeTypes) {
            if (this.nodeGroups.hasOwnProperty(subNodeType)) {
                for (let groupNodeType of this.nodeGroups[subNodeType]) {
                   if (!nodeTypes.includes(groupNodeType)) {
                        nodeTypes.push(groupNodeType);
                   }
                }
                nodeTypes.concat(this.nodeGroups[subNodeType]);
            } else if (!nodeTypes.includes(subNodeType)) {
                nodeTypes.push(subNodeType);
            }
        }
        return nodeTypes;
    }

    tokenizeRegExp(parser) {
        let tokenRegexes = [];
        for (let nodeType of this.tokenizerNodeTypes[parser]) {
            let re = this.expandTokenizePattern(nodeType);
            tokenRegexes.push(re);
            if (this.flags.debug) {
                console.log(nodeType + ' : ' + re)
            }
            // Test if the regexp is valid
            // to get the error for the nodeType
            // instead of an error for the entire combined regexp:
            RegExp(re, 'u');
        }
        return new RegExp('^(?:(' + tokenRegexes.join(')|(') + '))', 'u');
    }

    parseRegExp(nodeTypes, errorRecovery) {
        let parseRegexes = [];
        for (let nodeType of nodeTypes) {
            parseRegexes.push(this.expandParsePattern(nodeType, errorRecovery));
        }
        return new RegExp(parseRegexes.join('|'));
    }

    validateName(nodeType) {
        if (typeof(nodeType) != 'string' || !nodeType.match(/^[A-Za-z_]{2,}$/)) {
            throw new Error('invalid nodeType: ' + nodeType);
        }
        return nodeType;
    }

    tokenize(inputString, parser) {
        if (parser == null) {
            parser = this.mainParser;            
        }
        if (!this.tokenizerNodeTypes.hasOwnProperty(parser)) {
            throw new Error('no rules defined for parser: ' + parser);
        }
        let tokenizerNodeTypes = this.tokenizerNodeTypes[parser];
        let tokenNodes = [];
        let invalidString = '';
        let re = this.tokenizeRegExp(parser);
        while (inputString.length > 0) {
            let m = inputString.match(re);
            if (m == null) {
                invalidString += inputString.charAt(0);
                inputString = inputString.slice(1);
                continue;
            } else if (m.length != tokenizerNodeTypes.length + 1) {
                throw new Error('different number of capture groups than token node types');
            }
            let matched = false;
            for (let i=0; i < tokenizerNodeTypes.length; i++) {
                let nodeType = tokenizerNodeTypes[i];
                if (m[i+1] == null) {
                    continue;
                } else if (matched) {
                    throw new Error('multiple capture groups matched: ' + tokenizerNodeTypes[i]);
                }
                matched = true;
                if (invalidString.length > 0) {
                    console.warn('unable to tokenize: "' + invalidString + '"');
                    tokenNodes.push(['?', invalidString]);
                    invalidString = '';
                }
                let subParser = this.grammarRules[nodeType].subparser;
                if (subParser) {
                    tokenNodes = tokenNodes.concat(this.tokenize(m[i+1], subParser));
                } else {
                    tokenNodes.push([nodeType, m[i+1]]);
                }
                inputString = inputString.slice(m[i+1].length);
            }
        }
        if (invalidString.length > 0) {
            console.warn('unable to tokenize: ' + invalidString);
            tokenNodes.push(['?', invalidString]);
        }
        return tokenNodes;
    }

    parse(tokenNodes, parser) {
        if (parser == null) {
            parser = this.mainParser;            
        }
        if (!this.parserNodeTypes.hasOwnProperty(parser)) {
            throw new Error('no rules defined for parser: ' + parser);
        }
        let nodeString = '';
        let nodeId = 0;
        let errorRecovery = '';
        for (let node of tokenNodes) {
            nodeString += this.encodeNodeType(node[0]) + nodeId++ + ',';
            if (node[0] == '?') {
                errorRecovery = '(?:' + this.encodeNodeType('?') + '\\d+,)?';
            }
        }
        for (let didWork = true; didWork; ) {
            didWork = false;
            for (let percedenceGroup of this.parserNodeTypes[parser]) {
                let nodeType = null;
                let re = this.parseRegExp(percedenceGroup.nodeTypes, errorRecovery);
                let m = nodeString.match(re);
                if (m == null) {
                    continue;
                } else if (m.length != percedenceGroup.nodeTypes.length + 1) {
                    throw new Error('different number of capture groups than node types for given precedence');
                }

                let matched = false;
                let subNodeString = null;
                for (let i=0; i < percedenceGroup.nodeTypes.length; i++) {
                    if (m[i+1] == null) {
                        continue;
                    } else if (matched) {
                        throw new Error('multiple capture groups matched for percedence "' + percedenceGroup.percedence + '" : ' + percedenceGroup.nodeTypes[i]);
                    }
                    matched = true;
                    subNodeString = m[i+1];
                    nodeType = percedenceGroup.nodeTypes[i];
                }
                if (!matched) {
                    throw new Error('no capture group matched: ' + percedenceGroup.percedence);
                }

                nodeString = nodeString.replace(subNodeString, this.encodeNodeType(nodeType) + nodeId + ',');
                let subNodes = [];
                while (subNodeString.length > 0) {
                    let subNode = subNodeString.match(/([가-판])(\d+),/u); // [가-판] is the 10000 unicode chars between this.firstNodeTypeCharCode=44032..54032
                    if (subNode == null) {
                        throw new Error('unable to parse: ' + subNodeString);
                    }
                    let subNodeType = this.decodeNodeType(subNode[1]);
                    let subNodeId = subNode[2];
                    subNodes.push(tokenNodes[subNodeId]);
                    subNodeString = subNodeString.replace(subNode[0], '');
                }
                let subParser = this.grammarRules[nodeType].subparser;
                if (subParser) {
                    tokenNodes[nodeId++] = this.parse(subParser, subNodes);
                } else {
                    tokenNodes[nodeId++] = [nodeType, subNodes];
                }
                didWork = true;
                break;
            }
        }
        if (nodeString.match(/^[가-판]\d+,$/u) == null) {
            let subNodes = [];
            while (nodeString.length > 0) {
                let subNode = nodeString.match(/([가-판])(\d+),/u);
                if (subNode == null) {
                    throw new Error('unable to parse: ' + nodeString);
                }
                let subNodeType = this.decodeNodeType(subNode[1]);
                let subNodeId = subNode[2];
                subNodes.push(tokenNodes[subNodeId]);
                nodeString = nodeString.replace(subNode[0], '');
            }
            tokenNodes[nodeId++] = ['?', subNodes];
        }
        nodeId--;
        return tokenNodes[nodeId]; // parseTree
    }

    encodeNodeType(nodeType) {
        if (!this.nodeTypeIds.hasOwnProperty(nodeType)) {
            throw new Error('no such nodeType: ' + nodeType);
        }
        return String.fromCharCode(this.firstNodeTypeCharCode + this.nodeTypeIds[nodeType]);
    }

    decodeNodeType(unicodeToken) {
        let nodeType = this.nodeTypes[unicodeToken.charCodeAt(0) - this.firstNodeTypeCharCode];
        if (!nodeType) {
            throw new Error('invalid unicodeToken ' + unicodeToken);
        }
        return nodeType;
    }

    expandTokenizePattern(nodeType, visited = []) {
        if (visited.includes(nodeType)) {
            throw new Error('cycle detected: ' + nodeType);
        }
        visited.push(nodeType);
        if (!this.grammarRules[nodeType]) {
            throw new Error('no grammarRule for nodeType: ' + nodeType);
        }
        let tokenizePattern = this.grammarRules[nodeType].tokenizepattern;
        if (!tokenizePattern) {
            throw new Error('no tokenizepattern for nodeType: ' + nodeType);
        }
        let matchNodeTypes = tokenizePattern.match(/[A-Za-z_]{2,}/g) || [];
        for (let subNodeType of matchNodeTypes) {
            tokenizePattern = tokenizePattern.replace(new RegExp(subNodeType, 'g'), this.expandTokenizePattern(subNodeType, visited.slice(0)));
        }
        tokenizePattern = tokenizePattern.replace(/\s+/g, '');
        return tokenizePattern;
    }

    expandParsePattern(nodeType, errorRecovery = '') {
        let parsePattern = this.grammarRules[nodeType].parsepattern;
        let bracketExpressions = parsePattern.match(/\[[A-Za-z_]{2,}(?:\s+[A-Za-z_]{2,})*\]/g) || [];
        for (let bracketExpression of bracketExpressions) {
            let expandedBracketExpression = '';
            let bracketNodeTypes = bracketExpression.match(/[A-Za-z_]{2,}/g);
            for (let bracketNodeType of bracketNodeTypes) {
                if (this.nodeGroups.hasOwnProperty(bracketNodeType)) {
                    for (let nodeGroupType of this.nodeGroups[bracketNodeType]) {
                        expandedBracketExpression += this.encodeNodeType(nodeGroupType);
                    }
                } else {
                    expandedBracketExpression += this.encodeNodeType(bracketNodeType);
                }
            }
            parsePattern = parsePattern.replace(bracketExpression, '(?:[' + expandedBracketExpression + ']\\d+,' + errorRecovery + ')');
        }
        let subNodeTypes = parsePattern.match(/[A-Za-z_]{2,}/g) || [];
        for (let subNodeType of subNodeTypes) {
            let subNodeTypes = [];
            if (this.nodeGroups.hasOwnProperty(subNodeType)) {
                for (let nodeGroupType of this.nodeGroups[subNodeType]) {
                    subNodeTypes.push(this.encodeNodeType(nodeGroupType) + '\\d+,' + errorRecovery);
                }
            } else {
                subNodeTypes = [this.encodeNodeType(subNodeType) + '\\d+,' + errorRecovery];
            }
            parsePattern = parsePattern.replace(subNodeType, '(?:' + subNodeTypes.join('|') + ')');
        }
        parsePattern = parsePattern.replace(/\s+/g, '');
        return parsePattern;
    }

    eliminateNodes(parseTree) {
        for (this.didWork = true; this.didWork; ) {
            this.didWork = false;
            parseTree = this.eliminateNodesRecursive(parseTree);
        }
        return parseTree;
    }

    eliminateNodesRecursive(parseTree) {
        let reducedTree = [parseTree[0]];
        if (parseTree[1].constructor === Array) {
            let children = [];
            for (let child of parseTree[1]) {
                if (child[0] == '?') {
                    continue;
                }
                let isPrimitiveType = this.grammarRules[child[0]].primitivetype;
                let singleChild = child[1].constructor === Array && child[1].length == 1;
                let multipleChildren = child[1].constructor === Array && child[1].length > 1;

                if (isPrimitiveType || multipleChildren) {
                    children.push(this.eliminateNodesRecursive(child));
                } else if (!isPrimitiveType && singleChild) {
                    children.push(this.eliminateNodesRecursive(child[1][0]));
                    this.didWork = true;
                } else {
                    this.didWork = true;
                }
            }
            reducedTree[1] = children;
        } else {
            reducedTree[1] = parseTree[1];
        }
        return reducedTree;
    }

}

module.exports = DRegExp;
