class DRegExp {

    constructor(flags = {}) {
        this.firstNodeTypeCharCode = 44032; // Unbroken sequence of >10000 ideograms starting at this unicode char code
        this.flags = flags;
        this.resetGrammarRules();
    }

    resetGrammarRules() {
        this.mainParser = null;

        this.nodeTypes = ['?']; // Array of all node types.
                                // The first nodeType is a special one for unrecognized characters
        this.nodeTypeIds = {'?':0}; // nodeTypeId = this.nodeTypeIds[nodeType]
        this.nodeGroups = {}; // arrayOfNodeTypesInGroup = this.nodeGroups[nodeGroup]

        this.containsParserRules = false;

        this.tokenizerGrammarRules = {}; // tokenizerGrammarRule = this.tokenizerGrammarRules[nodeType]
        this.tokenDefiningTokenizerNodeTypes = []; // arrayOfTokenDefiningNodeTypes = this.tokenDefiningTokenizerNodeTypes[parser]
                                                   // Some tokenizer grammar rules are used only in other tokenizer grammar
                                                   // rules and they do not define tokens. this.tokenDefiningTokenizerNodeTypes contains
                                                   // the node types of the tokenizer grammar rules that do define tokens.
        this.tokenizerUnusedNodeTypes = []; // arrayOfUnusedTokenizerNodeTypes = this.tokenizerUnusedNodeTypes[parser]

        this.parserGrammarRules = []; // parserGrammarRule = parserGrammarRules[parserGrammarRuleId]
        this.parserGrammarRuleIdsByParserAndPrecedenceGroup = {}; // { precedence, parserGrammarRuleIds } = this.parserGrammarRuleIdsByParserAndPrecedenceGroup[parser][precedenceGroupIndex]

        this.nodeTypePrimitiveType = {}; // primitiveType = this.nodeTypePrimitiveType[nodeType]

        this.validParseSteps = 0;
        this.errorParserGrammarRuleId = null;

        this.numNodes = 0;
    }

    loadGrammarRules(csvInputArrayOfHashes) {
        let nodeTypeId = this.nodeTypes.length;
        for (let grammarRule of csvInputArrayOfHashes) {
            let parser = grammarRule.parser;

            // Skip empty lines:
            if (!grammarRule.parser) {
                continue;
            }

            // The main parser is the parser of the first grammar rule:
            if (this.mainParser == null) {
                this.mainParser = grammarRule.parser;
            }

            // Add the node type:
            let nodeType = this.validateName(grammarRule.nodetype);
            if (this.nodeGroups.hasOwnProperty(nodeType)) {
                throw new Error('nodeType ' + nodeType + ' is already declared as a nodeGroup');
            }
            if (!this.nodeTypes.includes(nodeType)) {
                this.nodeTypes.push(nodeType);
                this.nodeTypeIds[nodeType] = nodeTypeId++;
            }

            // Add the node group:
            if (grammarRule.nodegroup) {
                let nodeGroup = this.validateName(grammarRule.nodegroup);
                if (this.nodeTypes.includes(nodeGroup)) {
                    throw new Error('nodeGroup ' + nodeGroup + ' is already declared as a nodeType');
                }
                if (!this.nodeGroups.hasOwnProperty(nodeGroup)) {
                    this.nodeGroups[nodeGroup] = [];
                }
                this.nodeGroups[nodeGroup].push(nodeType);
            }

            // Split the grammar rules into tokenizer and parser grammar rules:
            {
                let isTokenizerGrammarRule = grammarRule.tokenizepattern && grammarRule.tokenizepattern.length > 0;
                let isParserGrammarRule = grammarRule.parsepattern && grammarRule.parsepattern.length > 0;
                let isPrimitiveType = grammarRule.primitivetype && grammarRule.primitivetype.length > 0;

                if (!isTokenizerGrammarRule && !isParserGrammarRule) {
                    throw new Error('A grammar rule must have tokenizer pattern or a parser pattern or both.');
                }

                if (isTokenizerGrammarRule) {
                    if (this.parserGrammarRules.some(r => r.nodetype === nodeType)) {
                        throw new Error('nodeType ' + nodeType + ' was used both for a tokenizer grammar rule and a parser grammar rule.');
                    }
                    if (this.tokenizerGrammarRules.hasOwnProperty(nodeType)) {
                        throw new Error('Duplicate nodeType ' + nodeType + ' among tokenizer grammar rules.');
                    }
                    this.tokenizerGrammarRules[nodeType] = grammarRule;
                }

                if (isParserGrammarRule) {
                    this.containsParserRules = true;

                    this.parserGrammarRules.push(grammarRule);
                }

                if (isPrimitiveType) {
                    if (this.nodeTypePrimitiveType.hasOwnProperty(nodeType)) {
                        if (this.nodeTypePrimitiveType[nodeType] !== grammarRule.primitivetype) {
                            throw new Error('Different primitiveTypes for same nodeType ' + nodeType + ' among grammar rules.');
                        }
                    } else {
                        this.nodeTypePrimitiveType[nodeType] = grammarRule.primitivetype;
                    }
                }

            }
        }
        this.processGrammarRules();
    }

    processGrammarRules() {
        // Populate this.parserGrammarRuleIdsByParserAndPrecedenceGroup
        this.parserGrammarRuleIdsByParserAndPrecedenceGroup = {};
        let prevPrecedence;
        for (let parserGrammarRuleId = 0; parserGrammarRuleId < this.parserGrammarRules.length; parserGrammarRuleId++) {
            let parserGrammarRule = this.parserGrammarRules[parserGrammarRuleId];

            let parser = parserGrammarRule.parser;

            if (!this.parserGrammarRuleIdsByParserAndPrecedenceGroup.hasOwnProperty(parser)) {
                this.parserGrammarRuleIdsByParserAndPrecedenceGroup[parser] = [];
            }

            let lastPrecedenceGroupIndex = this.parserGrammarRuleIdsByParserAndPrecedenceGroup[parser].length - 1;
            if (prevPrecedence != null && prevPrecedence === parserGrammarRule.precedence) {
                this.parserGrammarRuleIdsByParserAndPrecedenceGroup[parser][lastPrecedenceGroupIndex].parserGrammarRuleIds.push(parserGrammarRuleId);
            } else {
                for (let p of this.parserGrammarRuleIdsByParserAndPrecedenceGroup[parser]) {
                    if (p.precedence === parserGrammarRule.precedence) {
                        throw new Error('precedenceGroup ' + parserGrammarRule.precedence + ' already declared');
                    }
                }
                this.parserGrammarRuleIdsByParserAndPrecedenceGroup[parser]
                    .push({precedence: parserGrammarRule.precedence, parserGrammarRuleIds: [parserGrammarRuleId]});

                prevPrecedence = parserGrammarRule.precedence;
            }
        }

        let tokenizerSubNodeTypes = [];
        for (let nodeType in this.tokenizerGrammarRules) {
            tokenizerSubNodeTypes = this.extractNodeTypes(tokenizerSubNodeTypes, this.tokenizerGrammarRules[nodeType].tokenizepattern);
        }

        let parserSubNodeTypes = [];
        for (let parserGrammarRule of this.parserGrammarRules) {
            parserSubNodeTypes = this.extractNodeTypes(parserSubNodeTypes, parserGrammarRule.parsepattern);
        }

        for (let nodeType in this.tokenizerGrammarRules) {
            let parser = this.tokenizerGrammarRules[nodeType].parser;

            this.tokenDefiningTokenizerNodeTypes[parser] = [];
            this.tokenizerUnusedNodeTypes[parser] = [];
        }
        for (let nodeType in this.tokenizerGrammarRules) {
            let parser = this.tokenizerGrammarRules[nodeType].parser;

            if (parserSubNodeTypes.includes(nodeType)) {
                this.tokenDefiningTokenizerNodeTypes[parser].push(nodeType);
            } else if (!tokenizerSubNodeTypes.includes(nodeType)) {
                this.tokenDefiningTokenizerNodeTypes[parser].push(nodeType);
                
                if (this.containsParserRules) {
                    console.warn('unused nodeType: ' + nodeType);
                    this.tokenizerUnusedNodeTypes[parser].push(nodeType);
                }
            }
        }
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
            } else if (!nodeTypes.includes(subNodeType)) {
                nodeTypes.push(subNodeType);
            }
        }
        return nodeTypes;
    }

    tokenizeRegExp(parser) {
        let tokenRegexes = [];
        let captureGroups = {};
        let offset = 1;
        let i = 0;
        for (let nodeType of this.tokenDefiningTokenizerNodeTypes[parser]) {
            captureGroups[i++] = offset;
            let re = this.expandTokenizePattern(nodeType);
            RegExp(re, 'u'); // test if it's valid to spot errors early
            let o = this.offsetCaptureGroups(offset, re);
            offset = o.offset+1;
            re = o.re;
            tokenRegexes.push(re);
            if (this.flags.debug) {
                console.log(nodeType + ' : ' + re)
            }
        }
        let re = '(' + tokenRegexes.join(')|(') + ')';
        if (this.flags.debug) {
            process.stdout.write("\n");
            process.stdout.write(re);
            process.stdout.write("\n");
        }
        return {
            captureGroups: captureGroups,
            regexp: new RegExp(re, 'ug')
        }
    }

    parseRegExp(parserGrammarRuleIds, errorRecovery) {
        let parseRegexes = [];
        for (let parserGrammarRuleId of parserGrammarRuleIds) {
            parseRegexes.push(this.expandParsePattern(parserGrammarRuleId, errorRecovery));
        }
        return new RegExp(parseRegexes.join('|'), 'ug');
    }

    validateName(nodeType) {
        if (typeof(nodeType) != 'string' || !nodeType.match(/^[A-Za-z_]{2,}$/)) {
            throw new Error('invalid nodeType: ' + nodeType);
        }
        return nodeType;
    }

    tokenize(inputString, options = {}) {
        this.tokenNodes = [];
        this._tokenize(inputString, options);
        this.numNodes = this.tokenNodes.length;
        return this.tokenNodes;
    }

    _tokenize(inputString, options) {
        let parser = options.parser || this.mainParser;
        if (!this.tokenDefiningTokenizerNodeTypes.hasOwnProperty(parser)) {
            throw new Error('no rules defined for parser: ' + parser);
        }
        let tokenizerNodeTypes = this.tokenDefiningTokenizerNodeTypes[parser];
        let re = this.tokenizeRegExp(parser);
        let rx = re.regexp;
        console.log('regexp: ' + rx);
        let m;
        let lastIndex = 0;
        while (m = rx.exec(inputString)) {
            if (m.index > lastIndex) {
                let invalidString = inputString.slice(lastIndex, m.index);
                if (options.throwOnError) {
                    throw new Error('unable to tokenize ' + (m.index - lastIndex) + ' chars at pos ' + lastIndex + ' : "' + invalidString + '"');
                }
                this.tokenNodes.push(['?', invalidString, {tokenId: this.tokenNodes.length}]);
            }
            lastIndex = rx.lastIndex;
            let matched = false;
            for (let i=0; i < tokenizerNodeTypes.length; i++) {
                let nodeType = tokenizerNodeTypes[i];
                let matchedStr = m[re.captureGroups[i]];
                if (matchedStr == null) {
                    continue;
                } else if (matched) {
                    throw new Error('multiple capture groups matched: ' + tokenizerNodeTypes[i]);
                }
                matched = true;
                let subParser = this.tokenizerGrammarRules[nodeType].subparser;
                if (subParser) {
                    this._tokenize(matchedStr, Object.assign(options, {parser: subParser}));
                } else if (!this.tokenizerUnusedNodeTypes[parser].includes(nodeType)) {
                    this.tokenNodes.push([nodeType, matchedStr, {tokenId: this.tokenNodes.length}]);
                }
            }
        }
        if (inputString.length > lastIndex) {
            let invalidString = inputString.slice(lastIndex, inputString.length);
            if (options.throwOnError) {
                throw new Error('unable to tokenize at pos ' + lastIndex + ' : "' + invalidString + '"');
            }
            this.tokenNodes.push(['?', invalidString, {tokenId: this.tokenNodes.length}]);
        }
    }

    parse(tokenNodes, options = {}) {
        let parser = options.parser || this.mainParser;
        if (!this.parserGrammarRuleIdsByParserAndPrecedenceGroup.hasOwnProperty(parser)) {
            throw new Error('no rules defined for parser: ' + parser);
        }
        let nodeString = '';
        let nodeId = 0;
        let errorRecovery = '';
        this.validParseSteps = 0;
        for (let node of tokenNodes) {
            nodeString += this.encodeNodeType(node[0]) + nodeId++ + ',';
            if (node[0] == '?' && !options.throwOnError) {
                errorRecovery = '(?:' + this.encodeNodeType('?') + '\\d+,)?';
            }
        }
        for (let didWork = true; didWork; ) {
            didWork = false;
            for (let precedenceGroup of this.parserGrammarRuleIdsByParserAndPrecedenceGroup[parser]) {
                let re = this.parseRegExp(precedenceGroup.parserGrammarRuleIds, errorRecovery);
//                console.log('nodeString: ' + this.decodeNodeString(nodeString));
//                console.log('re: ' + this.decodeNodeString(re.toString()));
                let m = re.exec(nodeString);
                if (!m) {
                    continue;
                }
                if (m.length != precedenceGroup.parserGrammarRuleIds.length + 1) {
                    throw new Error('different number of capture groups than node types for given precedence');
                }
                let matched = false;
                let matchedStr = m[0];
                let subNodeString = null;
                let parserGrammarRuleId = null;
                let nodeType = null;
                for (let i=0; i < precedenceGroup.parserGrammarRuleIds.length; i++) {
                    if (m[i+1] == null) {
                        continue;
                    } else if (matched) {
                        throw new Error('multiple capture groups matched for precedence "' + precedenceGroup.precedence + '" : ' + precedenceGroup.nodeTypes[i]);
                    }
                    matched = true;
                    subNodeString = m[i+1];
                    parserGrammarRuleId = precedenceGroup.parserGrammarRuleIds[i];
                    nodeType = this.parserGrammarRules[parserGrammarRuleId].nodetype;
                }
                if (!matched) {
                    throw new Error('no capture group matched: ' + precedenceGroup.precedence);
                }
                let newNodeId = nodeId++;
                let subNodes = [];
                let subNodeTypes = [];
                let subLastIndex = 0;
                let subNode;
                let subRegexp = /([가-판])(\d+),/ug; // [가-판] is the 10000 unicode chars between this.firstNodeTypeCharCode=44032..54032
                while (subNode = subRegexp.exec(subNodeString)) {
                    if (subNode.index > subLastIndex) {
                        throw new Error('did not match immediately after previous match');
                    }
                    subNodeTypes.push(this.decodeNodeType(subNode[1]));
                    let subNodeId = subNode[2];
                    subNodes.push(tokenNodes[subNodeId]);
                    subLastIndex = subRegexp.lastIndex;
                }
                if (subNodes.length == 0) {
                    throw new Error('unable to parse: ' + subNodeString);
                }
                let subParser = this.parserGrammarRules[parserGrammarRuleId].subparser;
                if (subParser) {
                    tokenNodes[newNodeId] = this.parse(subNodes, Object.assign(options, {parser: subParser}));
                } else {
                    let subParseTree = [nodeType, subNodes];
                    if (options.hasOwnProperty('expectedParseTree') && this.errorGrammarRuleId == null) {
                        if (this.parseTreeContainsSubParseTree(options.expectedParseTree, subParseTree)) {
                            this.validParseSteps++;
                        } else if (this.errorParserGrammarRuleId == null) {
                            console.log('ERROR after validParseSteps ' + this.validParseSteps + ' parserGrammarRuleId ' + parserGrammarRuleId + ' ' + nodeType + ' <- ' + subNodeTypes.join(' '));
                            this.errorParserGrammarRuleId = parserGrammarRuleId;
                        }
                    }
                    tokenNodes[newNodeId] = subParseTree;
//                    console.log(nodeType + ' <- ' + subNodeTypes.join(' '));
                }
                matchedStr = matchedStr.replace(subNodeString, this.encodeNodeType(nodeType) + newNodeId + ',');
                nodeString = nodeString.slice(0, m.index) + matchedStr + nodeString.slice(re.lastIndex, nodeString.length);
                re.lastIndex = m.index;
                if (this.maxNodes && nodeId >= this.maxNodes) {
                    didWork = false;
                    break;
                }
                didWork = true;
                break;
            }
        }
        if (nodeString.match(/^[가-판]\d+,$/u) == null) {
            if (options.throwOnError) {
                throw new Error('unable to parse: ' + nodeString);
            }
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
        this.numNodes = nodeId;
        return tokenNodes[nodeId-1]; // parseTree
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

    decodeNodeString(nodeString) {
        let m;
        while (m = nodeString.match(/([가-판])/u)) {
            nodeString = nodeString.replace(m[1], this.decodeNodeType(m[1]));
        }
        return nodeString;
    }

    expandTokenizePattern(nodeType, visited = []) {
        if (visited.includes(nodeType)) {
            throw new Error('cycle detected: ' + nodeType);
        }
        visited.push(nodeType);
        if (!this.tokenizerGrammarRules[nodeType]) {
            throw new Error('no grammarRule for nodeType: ' + nodeType);
        }
        let tokenizePattern = this.tokenizerGrammarRules[nodeType].tokenizepattern;
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

    expandParsePattern(parserGrammarRuleId, errorRecovery = '') {
        let parsePattern = this.parserGrammarRules[parserGrammarRuleId].parsepattern;
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
                let isPrimitiveType = this.nodeTypePrimitiveType.hasOwnProperty(child[0]);
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

    offsetCaptureGroups(offset, re) {
        let captureGroups = re.match(/(^|[^\\])(\\\\)*\([^?]/g) || [];
        let numCaptureGroups = captureGroups.length;
        let backReferences = re.match(/(^|[^\\])(\\\\)*\\\d+/g) || [];
        let numBackReferences = backReferences.length;
        if (numCaptureGroups != numBackReferences) {
            throw new Error('Number of capture groups in regexp (' + re + ') not equal to number of back references: ' + numCaptureGroups + ' != ' + numBackReferences);
        }
        for (let backRef of backReferences) {
            let refNum = backRef.match(/\d+$/)[0];
            let newBackRef = backRef.replace(refNum, (parseInt(refNum) + offset).toString());
            re = re.replace(backRef, newBackRef);
        }
        return {offset: offset+numCaptureGroups, re: re};
    }

    tokenEscape(S) {
        let str = String(S);
        let cpList = Array.from(str[Symbol.iterator]());
        let cuList = [];
        let lastChar;
        for(let c of cpList) {
            if (c == ' ') {
                cuList.push("\\x20");
            } else if (c == "\t") {
                cuList.push("\\t");
            } else if (c == "\n") {
                cuList.push("\\n");
            } else {
                if("^$\\.*+?()[]{}|".indexOf(c) !== -1) {
                    cuList.push("\\");
                } else if (lastChar && lastChar.match(/[a-zA-Z_]/) && c.match(/[a-zA-Z_]/)) {
                    cuList.push(' ');
                }
                cuList.push(c);
            }
            lastChar = c;
        }
        let L = cuList.join('');
        return L;
    }

    deriveGrammar(sourceCodeString, parseTree, csvInputArrayOfHashes = []) {
        let parser = parseTree[0];
        let tokens = this.unparse(parseTree);
        console.log('tokens:'+JSON.stringify(tokens));
        this._deriveGrammar(parser, parseTree, csvInputArrayOfHashes);
        for(let r of csvInputArrayOfHashes) {
            if (r.tokenizepatterns) {
                if (r.tokenizepatterns.length > 0) {
                    r.tokenizepattern = r.tokenizepatterns.join('|');
                }
                delete r.tokenizepatterns;
            }
        }

        csvInputArrayOfHashes = this.fixContextSensitive(csvInputArrayOfHashes);

        csvInputArrayOfHashes = this.filterDups(csvInputArrayOfHashes);

        csvInputArrayOfHashes = this.compareAndFixTokenizer(sourceCodeString, tokens, csvInputArrayOfHashes);
        return csvInputArrayOfHashes;
    }

    filterDups(csvInputArrayOfHashes) {
        let newCsvInputArrayOfHashes = [];
        for(let r1 of csvInputArrayOfHashes) {
            if (newCsvInputArrayOfHashes.some(r2 => r2.parser === r1.parser && r2.tokenizepattern === r1.tokenizepattern && r2.parsepattern === r1.parsepattern && r2.nodetype === r1.nodetype)) {
                console.log('Skipping dup rule: ' + JSON.stringify(r1));
                continue;
            }
            newCsvInputArrayOfHashes.push(r1);
        }
        return newCsvInputArrayOfHashes;
    }

    fixContextSensitive(csvInputArrayOfHashes) {
        let contexts = {};
        for(let r of csvInputArrayOfHashes) {
            if (r.parsepattern.length > 0) {
                if (!contexts.hasOwnProperty(r.parser)) {
                    contexts[r.parser] = {};
                }
                if (!contexts[r.parser].hasOwnProperty(r.parsepattern)) {
                    contexts[r.parser][r.parsepattern] = {leftnodetype: {}, rightnodetype: {}, resultNodeTypes: [], maxCount: 0, mostSelectiveContext: null};
                }
                console.log(JSON.stringify(r));
                for(let context of ['leftnodetype','rightnodetype']) {
                    if (r[context]) {
                        if (!contexts[r.parser][r.parsepattern][context].hasOwnProperty(r[context])) {
                            contexts[r.parser][r.parsepattern][context][r[context]] = {};
                        }
                        if (!contexts[r.parser][r.parsepattern][context][r[context]].hasOwnProperty(r.nodetype)) {
                            contexts[r.parser][r.parsepattern][context][r[context]][r.nodetype] = 0;
                        }
                        contexts[r.parser][r.parsepattern][context][r[context]][r.nodetype]++;
                    }
                }
                if (!contexts[r.parser][r.parsepattern].resultNodeTypes.includes(r.nodetype)) {
                    contexts[r.parser][r.parsepattern].resultNodeTypes.push(r.nodetype);
                }
            }
        }
        let isAmbiguous = false;
        for(let parser in contexts) {
            for(let parsepattern in contexts[parser]) {
                if (contexts[parser][parsepattern].resultNodeTypes.length < 2) {
                    delete contexts[parser][parsepattern];
                    continue;
                }
                isAmbiguous = true;
                for(let context in contexts[parser][parsepattern]) {
                    for(let contextNodeType in contexts[parser][parsepattern][context]) {
                        if (Object.keys(contexts[parser][parsepattern][context][contextNodeType]).length === 1) {
                            for(let resultNodeType in contexts[parser][parsepattern][context][contextNodeType]) {
                                let count = contexts[parser][parsepattern][context][contextNodeType][resultNodeType];
                                if (count > contexts[parser][parsepattern].maxCount) {
                                    contexts[parser][parsepattern].maxCount = count;
                                    contexts[parser][parsepattern].mostSelectiveContext = {contextSide: context, contextNodeType: contextNodeType, resultNodeType: resultNodeType};
                                }
                            }
                        }
                    }
                }
            }
        }
        console.log('contexts:' + JSON.stringify(contexts,null,4));
        if (!isAmbiguous) {
            return csvInputArrayOfHashes;
        }
        let newCsvInputArrayOfHashes = [];
        for(let r of csvInputArrayOfHashes) {
            if (contexts[r.parser] && contexts[r.parser][r.parsepattern]) {
                let mostSelectiveContext = contexts[r.parser][r.parsepattern].mostSelectiveContext;
                if (r[mostSelectiveContext.contextSide] === mostSelectiveContext.contextNodeType && r.nodetype === mostSelectiveContext.resultNodeType) {
                    if (mostSelectiveContext.contextSide === 'leftnodetype') {
                        r.parsepattern = r.leftnodetype + ' ' + r.parsepattern;
                        console.log('new left parsepattern: ' + r.parsepattern);
                        delete r.leftnodetype;
                    } else if (mostSelectiveContext.contextSide === 'rightnodetype') {
                        r.parsepattern = r.parsepattern + ' ' + r.rightnodetype;
                        console.log('new right parsepattern: ' + r.parsepattern);
                        delete r.rightnodetype;
                    } else {
                        throw new Error('Unexpected contextSide: ' + mostSelectiveContext.contextSide);
                    }
                }
            }
            newCsvInputArrayOfHashes.push(r);
        }
        return this.fixContextSensitive(newCsvInputArrayOfHashes);
    }

    _deriveGrammar(parser, parseTree, csvInputArrayOfHashes, leftNodeType = '', rightNodeType = '') {
        let nodeType = parseTree[0];
        let tokenizePattern;
        let parsePattern;
        if (typeof(parseTree[1]) === 'string') {
            tokenizePattern = this.tokenEscape(parseTree[1]);
        } else {
            let parsePatternNodeTypes = [];
            for (let i=0; parseTree[1][i]; i++) {
                let subTree = parseTree[1][i];
                let subLeftNodeType = '';
                let subRightNodeType = '';
                parsePatternNodeTypes.push(subTree[0]);
                if (parseTree[1][i - 1]) {
                    subLeftNodeType = parseTree[1][i - 1][0];
                }
                if (parseTree[1][i + 1]) {
                    subRightNodeType = parseTree[1][i + 1][0];
                }
                this._deriveGrammar(parser, subTree, csvInputArrayOfHashes, subLeftNodeType, subRightNodeType);
            }
            parsePattern = '(' + parsePatternNodeTypes.join(' ') + ')';
        }

        let rule;
        // Check if pattern already exists and return if so
        for (let r of csvInputArrayOfHashes) {
            if (typeof(parseTree[1]) === 'string') {
                if (nodeType === r.nodetype) {
                    if (r.tokenizepatterns.length > 0 && r.tokenizepatterns.includes(tokenizePattern)) {
                        return;
                    } else {
                        rule = r;
                    }
                }
            } else {
                if (r.parsepattern.length > 0 && r.parsepattern === parsePattern && nodeType === r.nodetype && leftNodeType === r.leftnodetype && rightNodeType === r.rightnodetype) {
//                    return;
                }
            }
        }

        // Inject new rule at beginning if necessary
        if (rule == undefined) {
            rule = {
                parser: parser,
                nodetype: nodeType,
                tokenizepatterns: [],
                tokenizepattern: '',
                parsepattern: '',
                primitivetype: '',
                nodegroup: '',
                precedence: '',
                subparser: '',
                leftnodetype: '',
                rightnodetype: ''
            };
            csvInputArrayOfHashes.push(rule);
        }

        if (typeof(parseTree[1]) === 'string') {
            rule.tokenizepatterns.push(tokenizePattern);
        } else {
            rule.parsepattern = parsePattern;
            rule.leftnodetype = leftNodeType;
            rule.rightnodetype = rightNodeType;
        }

        return;
    }

    compareAndFixTokenizer(sourceCodeString, expectedTokens, csvInputArrayOfHashes) {
        this.resetGrammarRules();
        this.loadGrammarRules(csvInputArrayOfHashes);
        let resultTokens = this.tokenize(sourceCodeString);
        let isEqual = resultTokens.length == expectedTokens.length;
        let i;
        for (i = 0; resultTokens[i] && expectedTokens[i]; i++) {
            if (resultTokens[i][0] != expectedTokens[i][0]) {
                console.log('resultTokens[i][0] != expectedTokens[i][0]: ' + i + ' ' + resultTokens[i][0] + ' ' + expectedTokens[i][0]);
                isEqual = false;
                break;
            }
            if (resultTokens[i][1] != expectedTokens[i][1]) {
                throw new Error('nodeType ' + resultTokens[i][0] + ' is correct but literal differs: "' + resultTokens[i][1] + '" vs "' + expectedTokens[i][1] + '"');
            }
        }
        if (isEqual) {
            console.log('OK csvInputArrayOfHashes');
            return csvInputArrayOfHashes;
        }
        let resultToken;
        let expectedToken;
        for(let r of csvInputArrayOfHashes) {
            if (r.nodetype == resultTokens[i][0]) {
                resultToken = r;
            } else if (r.nodetype == expectedTokens[i][0]) {
                expectedToken = r;
            }
        }
        if (resultToken == undefined) {
            throw new Error('dregexp nodeType ' + resultTokens[i][0] + ' not found in csvInputArrayOfHashes');
        }
        if (expectedToken == undefined) {
            throw new Error('expectedToken nodeType ' + expectedTokens[i][0] + ' not found in csvInputArrayOfHashes');
        }
        let newCsvInputArrayOfHashes = [];
        for(let r of csvInputArrayOfHashes) {
            if (r.nodetype == expectedToken.nodetype) {
                newCsvInputArrayOfHashes.push(expectedToken);
                newCsvInputArrayOfHashes.push(resultToken);
            } else if (r.nodetype != resultToken.nodetype) {
                newCsvInputArrayOfHashes.push(r);
            }
        }
        return this.compareAndFixTokenizer(sourceCodeString, expectedTokens, newCsvInputArrayOfHashes);
    }

    unparse(parseTree, tokens = []) {
        if (typeof(parseTree[1]) === 'string') {
            tokens.push(parseTree);
        } else {
            for (let subTree of parseTree[1]) {
                this.unparse(subTree, tokens);
            }
        }
        return tokens;
    }

    compareParseTrees(parseTree1, parseTree2, debugInfo = []) {
        if (parseTree1[0] !== parseTree2[0]) {
            debugInfo.push('parseTree1[0] !== parseTree2[0] : ' + parseTree1[0] + ' !== ' + parseTree2[0]);
            return false;
        } else if (typeof(parseTree1[1]) === 'string'
                && typeof(parseTree2[1]) === 'string'
                && parseTree1[1] === parseTree2[1]
        ) {
            return true;
        } else if (Array.isArray(parseTree1[1]) && Array.isArray(parseTree2[1])) {
            // both parseTrees are arrays
            for (let i = 0; parseTree1[1][i] && parseTree2[1][i]; i++) {
                if (!this.compareParseTrees(parseTree1[1][i], parseTree2[1][i], debugInfo)) {
                    return false;
                }
            }
            if (parseTree1[1].length !== parseTree2[1].length) {
                debugInfo.push('parseTree1[1].length !== parseTree2[1].length : ' + parseTree1[1].length + ' !== ' + parseTree2[1].length);
                return false;
            }
            return true;
        } else if (typeof(parseTree1[1]) === 'string' && Array.isArray(parseTree2[1])) {
            debugInfo.push('parseTree1 is string, parseTree2 is array');
            return false;
        } else if (typeof(parseTree2[1]) === 'string' && Array.isArray(parseTree1[1])) {
            debugInfo.push('parseTree2 is string, parseTree1 is array');
            return false;
        } else {
            throw new Error('ERROR Unexpected: parseTree1: ' + JSON.stringify(parseTree1) + ' parseTree2: ' + JSON.stringify(parseTree2));
        }
    }

    parseTreeContainsSubParseTree(parseTree, subParseTree) {
        if (JSON.stringify(parseTree) === JSON.stringify(subParseTree)) {
//            console.log('OK subParseTree: ' + JSON.stringify(subParseTree,null,4));
            return true;
        }
        if (Array.isArray(parseTree[1])) {
            for (let t of parseTree[1]) {
                if (this.parseTreeContainsSubParseTree(t, subParseTree)) {
                    return true;
                }
            }
        }
        return false;
    }

    exportGrammarRules() {
        let grammarRules = [];
        for (let i=1; i < this.nodeTypes.length; i++) {
            if (this.tokenizerGrammarRules.hasOwnProperty(this.nodeTypes[i])) {
                grammarRules.push(this.tokenizerGrammarRules[this.nodeTypes[i]]);
            }
        }
        for (let parser in this.parserGrammarRuleIdsByParserAndPrecedenceGroup) {
            for (let parserGroup of this.parserGrammarRuleIdsByParserAndPrecedenceGroup[parser]) {
                for (let parserGrammarRuleId of parserGroup.parserGrammarRuleIds) {
                    grammarRules.push(this.parserGrammarRules[parserGrammarRuleId]);
                }
            }
        }
        return grammarRules.slice(0);
    }

    fixPrecedenceGroups() {
        if (this.errorParserGrammarRuleId == null) {
            return;
        }
        let moveParserGrammarRuleId = null;
        let newParserGrammarRuleIdsByParserAndPrecedenceGroup = {};
        for (let parser in this.parserGrammarRuleIdsByParserAndPrecedenceGroup) {
            let newParserGroups = [];
            let precedence = 1;
            for (let parserGroup of this.parserGrammarRuleIdsByParserAndPrecedenceGroup[parser]) {
                let newParserGrammarRuleIds = [];
                if (moveParserGrammarRuleId != null) {
                    newParserGrammarRuleIds.push(moveParserGrammarRuleId);
                    this.parserGrammarRules[moveParserGrammarRuleId].precedence = precedence;
                    moveParserGrammarRuleId = null;
                }
                for (let parserGrammarRuleId of parserGroup.parserGrammarRuleIds) {
                    if (parserGrammarRuleId === this.errorParserGrammarRuleId) {
                        if (moveParserGrammarRuleId != null) {
                            throw new Error('Duplicate parserGrammarRuleId ' + parserGrammarRuleId.toString());
                        }
                        moveParserGrammarRuleId = parserGrammarRuleId;
                    } else {
                        newParserGrammarRuleIds.push(parserGrammarRuleId);
                        this.parserGrammarRules[parserGrammarRuleId].precedence = precedence;
                        if (moveParserGrammarRuleId != null) {
                            newParserGrammarRuleIds.push(moveParserGrammarRuleId);
                            this.parserGrammarRules[moveParserGrammarRuleId].precedence = precedence;
                            moveParserGrammarRuleId = null;
                        }
                    }
                }
                if (newParserGrammarRuleIds.length > 0) {
                    newParserGroups.push({precedence: (precedence++).toString(), parserGrammarRuleIds: newParserGrammarRuleIds});
                }
            }
            if (moveParserGrammarRuleId != null) {
                this.parserGrammarRules[moveParserGrammarRuleId].precedence = precedence;
                newParserGroups.push({precedence: (precedence++).toString(), parserGrammarRuleIds: [moveParserGrammarRuleId]});
                moveParserGrammarRuleId = null;
            }
            newParserGrammarRuleIdsByParserAndPrecedenceGroup[parser] = newParserGroups;
        }
        console.log(JSON.stringify(newParserGrammarRuleIdsByParserAndPrecedenceGroup));
        this.parserGrammarRuleIdsByParserAndPrecedenceGroup = newParserGrammarRuleIdsByParserAndPrecedenceGroup;
        this.errorParserGrammarRuleId = null;
    }

}

module.exports = DRegExp;
