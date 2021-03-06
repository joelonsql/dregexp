class DRegExp {

    constructor(flags = {}) {
        this.firstNodeTypeCharCode = 44032; // Unbroken sequence of >10000 ideograms starting at this unicode char code
        this.flags = flags;
        this.resetGrammarRules();
    }

    throwError(msg) {
        console.log('ERROR: ' + msg);
        throw new Error(msg);
    }

    resetGrammarRules() {
        this.mainParser = null;

        this.nodeTypes = ['?']; // Array of all node types.
                                // The first nodeType is a special one for unrecognized characters
        this.nodeTypeIds = {'?':0}; // nodeTypeId = this.nodeTypeIds[nodeType]
        this.nodeGroups = {}; // arrayOfNodeTypesInGroup = this.nodeGroups[nodeGroup]

        this.containsParserRules = false;

        this.tokenizerGrammarRules = {}; // tokenizerGrammarRule = this.tokenizerGrammarRules[nodeType]
        this.tokenDefiningTokenizerNodeTypes = {}; // arrayOfTokenDefiningNodeTypes = this.tokenDefiningTokenizerNodeTypes[parser]
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
                this.throwError('nodeType ' + nodeType + ' is already declared as a nodeGroup');
            }
            if (!this.nodeTypes.includes(nodeType)) {
                this.nodeTypes.push(nodeType);
                this.nodeTypeIds[nodeType] = nodeTypeId++;
            }

            // Add the node group:
            if (grammarRule.nodegroup) {
                let nodeGroup = this.validateName(grammarRule.nodegroup);
                if (this.nodeTypes.includes(nodeGroup)) {
                    this.throwError('nodeGroup ' + nodeGroup + ' is already declared as a nodeType');
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
                    this.throwError('A grammar rule must have tokenizer pattern or a parser pattern or both.');
                }

                if (isTokenizerGrammarRule) {
                    if (this.parserGrammarRules.some(r => r.nodetype === nodeType)) {
                        this.throwError('nodeType ' + nodeType + ' was used both for a tokenizer grammar rule and a parser grammar rule.');
                    }
                    if (this.tokenizerGrammarRules.hasOwnProperty(nodeType)) {
                        this.throwError('Duplicate nodeType ' + nodeType + ' among tokenizer grammar rules.');
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
                            this.throwError('Different primitiveTypes for same nodeType ' + nodeType + ' among grammar rules.');
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
                        this.throwError('precedenceGroup ' + parserGrammarRule.precedence + ' already declared');
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
//                    console.log('unused nodeType: ' + nodeType);
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
            this.throwError('invalid nodeType: ' + nodeType);
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
            this.throwError('no rules defined for parser: ' + parser);
        }
        let tokenizerNodeTypes = this.tokenDefiningTokenizerNodeTypes[parser];
        let re = this.tokenizeRegExp(parser);
        let rx = re.regexp;
//        console.log('regexp: ' + rx);
        let m;
        let lastIndex = 0;
        while (m = rx.exec(inputString)) {
            if (m.index > lastIndex) {
                let invalidString = inputString.slice(lastIndex, m.index);
                if (options.throwOnError) {
                    this.throwError('unable to tokenize ' + (m.index - lastIndex) + ' chars at pos ' + lastIndex + ' : "' + invalidString + '"');
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
                    this.throwError('multiple capture groups matched: ' + tokenizerNodeTypes[i]);
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
                this.throwError('unable to tokenize at pos ' + lastIndex + ' : "' + invalidString + '"');
            }
            this.tokenNodes.push(['?', invalidString, {tokenId: this.tokenNodes.length}]);
        }
    }

    parse(tokenNodes, options = {}) {
        let parser = options.parser || this.mainParser;
        // if (!this.parserGrammarRuleIdsByParserAndPrecedenceGroup.hasOwnProperty(parser)) {
        //     this.throwError('no rules defined for parser: ' + parser);
        // }
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
        for (let didWork = true; didWork && this.parserGrammarRuleIdsByParserAndPrecedenceGroup[parser]; ) {
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
                    this.throwError('different number of capture groups than node types for given precedence');
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
                        this.throwError('multiple capture groups matched for precedence "' + precedenceGroup.precedence + '" : ' + precedenceGroup.nodeTypes[i]);
                    }
                    matched = true;
                    subNodeString = m[i+1];
                    parserGrammarRuleId = precedenceGroup.parserGrammarRuleIds[i];
                    nodeType = this.parserGrammarRules[parserGrammarRuleId].nodetype;
                }
                if (!matched) {
                    this.throwError('no capture group matched: ' + precedenceGroup.precedence);
                }
                let newNodeId = nodeId++;
                let subNodes = [];
                let subNodeTypes = [];
                let subLastIndex = 0;
                let subNode;
                let subRegexp = /([가-판])(\d+),/ug; // [가-판] is the 10000 unicode chars between this.firstNodeTypeCharCode=44032..54032
                while (subNode = subRegexp.exec(subNodeString)) {
                    if (subNode.index > subLastIndex) {
                        this.throwError('did not match immediately after previous match');
                    }
                    subNodeTypes.push(this.decodeNodeType(subNode[1]));
                    let subNodeId = subNode[2];
                    subNodes.push(tokenNodes[subNodeId]);
                    subLastIndex = subRegexp.lastIndex;
                }
                if (subNodes.length == 0) {
                    this.throwError('unable to parse: ' + subNodeString);
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
//                            console.log('ERROR after validParseSteps ' + this.validParseSteps + ' parserGrammarRuleId ' + parserGrammarRuleId + ' ' + nodeType + ' <- ' + subNodeTypes.join(' '));
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
                this.throwError('unable to parse: ' + nodeString);
            }
            let subNodes = [];
            while (nodeString.length > 0) {
                let subNode = nodeString.match(/([가-판])(\d+),/u);
                if (subNode == null) {
                    this.throwError('unable to parse: ' + nodeString);
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
            this.throwError('no such nodeType: ' + nodeType);
        }
        return String.fromCharCode(this.firstNodeTypeCharCode + this.nodeTypeIds[nodeType]);
    }

    decodeNodeType(unicodeToken) {
        let nodeType = this.nodeTypes[unicodeToken.charCodeAt(0) - this.firstNodeTypeCharCode];
        if (!nodeType) {
            this.throwError('invalid unicodeToken ' + unicodeToken);
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
            this.throwError('cycle detected: ' + nodeType);
        }
        visited.push(nodeType);
        if (!this.tokenizerGrammarRules[nodeType]) {
            this.throwError('no grammarRule for nodeType: ' + nodeType);
        }
        let tokenizePattern = this.tokenizerGrammarRules[nodeType].tokenizepattern;
        if (!tokenizePattern) {
            this.throwError('no tokenizepattern for nodeType: ' + nodeType);
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
            this.throwError('Number of capture groups in regexp (' + re + ') not equal to number of back references: ' + numCaptureGroups + ' != ' + numBackReferences);
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

    isInConflict(r1, r2) {
        let rmin;
        let rmax;
        if (r1.length < r2.length) {
            rmin = r1;
            rmax = r2;
        } else {
            rmin = r2;
            rmax = r1;
        }
        for (let offset=0; offset < rmax.length-rmin.length+1; offset++) {
            if (JSON.stringify(rmax.slice(offset,offset+rmin.length)) === JSON.stringify(rmin)) {
//                console.log('Conflict:' + JSON.stringify(rmin) + ' with ' + JSON.stringify(rmax));
                return true;
            }
        }
        return false;
    }

    _updateState(stateArray, num) {
        let sum = 0;
        let maxValues = [];
        for (let i = stateArray.length - 1; i >= 0; i--) {
            maxValues[i] = num - sum;
            sum = sum + stateArray[i];
        }
        for (let i = 0; i < stateArray.length; i++) {
            if (stateArray[i] != maxValues[i]) {
                stateArray[i]++;
                return false;
            } else {
                if (i == stateArray.length - 1) {
                    return true;
                }
                stateArray[i] = 0;
            }   
        }
    }

    _conflictGroups(parsePatterns) {
        let ruleGroups = [];
        for (let parsePatternId1=0; parsePatternId1 < parsePatterns.length; parsePatternId1++) {
            let isConflict = false;
            group_loop:
            for (let g of ruleGroups) {
                for (let parsePatternId2 of g) {
                    if (this.isInConflict(parsePatterns[parsePatternId1].parsePattern, parsePatterns[parsePatternId2].parsePattern)) {
                        isConflict = true;
                        g.push(parsePatternId1);
                        break group_loop;
                    }
                }
            }
            if (isConflict === false) {
                ruleGroups.push([parsePatternId1]);
            }
        }
        return ruleGroups.filter(em => em.length > 1);
    }

    _getSumCombos(sum, num) {
        if (num === 0) {
            return [0];
        }
        let result = [];
        let state = [];
        for (let i=0; i<num-1; i++) {
            state.push(0);
        }
        while (true) {
            let tmp = state.slice(0);
            let subsum = 0;
            for (let x of tmp) {
                subsum += x;
            }
            tmp.push(sum - subsum);
            result.push(tmp);
            if (this._updateState(state, sum)) {
                return result;
            }
        }
    }

    deriveGrammar(sourceCodeString, parseTree, csvInputArrayOfHashes = []) {
        let parser = parseTree[0];
        let tokens = this.unparse(parseTree);
//        console.log('tokens:'+JSON.stringify(tokens));
        this._deriveTokenizer(parser, parseTree, csvInputArrayOfHashes);
        for(let r of csvInputArrayOfHashes) {
            if (r.tokenizepatterns) {
                if (r.tokenizepatterns.length > 0) {
                    r.tokenizepattern = r.tokenizepatterns.join('|');
                }
                delete r.tokenizepatterns;
            }
        }

        let parsePatterns = [];
        this._deriveParsePatterns(parser, parseTree, parsePatterns);
//        console.log('parsePatterns:' + JSON.stringify(parsePatterns,null,4));

        for (let p of parsePatterns) {
            csvInputArrayOfHashes.push({
                parser: parser,
                nodetype: p.nodeType,
                tokenizepattern: '',
                parsepattern: '(' + p.parsePattern.join(' ') + ')',
                primitivetype: '',
                nodegroup: '',
                precedence: '',
                subparser: ''
            });
        }
        csvInputArrayOfHashes = this.compareAndFixTokenizer(sourceCodeString, tokens, csvInputArrayOfHashes);
        let newCsvInputArrayOfHashes = [];
        for (let p of csvInputArrayOfHashes) {
            if (p.tokenizepattern.length > 0) {
                newCsvInputArrayOfHashes.push(p);
            }
        }
        csvInputArrayOfHashes = newCsvInputArrayOfHashes;

        let conflictGroups = this._conflictGroups(parsePatterns);
//        console.log('conflictGroups: ' + JSON.stringify(conflictGroups));

        let num = 0;
        for (let c of conflictGroups) {
            for (let parsePatternId of c) {
                num++;
            }
        }
        num *= 2;
        for (let sum=0; sum<10; sum++) {
//            console.log('sum ' + sum);
            let combos = this._getSumCombos(sum,num);
            for (let c of combos) {
                let newCsvInputArrayOfHashes = JSON.parse(JSON.stringify(csvInputArrayOfHashes));
                let i = 0;
                let parsePatternIds = [];
                for (let cg of conflictGroups) {
                    for (let parsePatternId of cg) {
                        parsePatternIds.push(parsePatternId);
                        let numLeft = c[i++];
                        let numRight = c[i++];
                        for (let ctx of parsePatterns[parsePatternId].contexts) {
                            let left = ctx.left.slice(0,numLeft).reverse().join(' ');
                            let right = ctx.right.slice(0,numRight).join(' ');
                            let nodeType = parsePatterns[parsePatternId].nodeType;
                            let parsePattern = '(' + parsePatterns[parsePatternId].parsePattern.join(' ') + ')';
                            if (left.length > 0) {
                                parsePattern = left + ' ' + parsePattern;
                            }
                            if (right.length > 0) {
                                parsePattern = parsePattern + ' ' + right;
                            }
                            if (!newCsvInputArrayOfHashes.some(r => r.nodetype === nodeType && r.parsepattern === parsePattern)) {
                                if (left.length > 0 || right.length > 0) {
                                    console.log('Testing context: ' + nodeType + ' ::= ' + parsePattern);
                                }
                                newCsvInputArrayOfHashes.push({
                                    parser: parser,
                                    nodetype: nodeType,
                                    tokenizepattern: '',
                                    parsepattern: parsePattern,
                                    primitivetype: '',
                                    nodegroup: '',
                                    precedence: '',
                                    subparser: ''
                                });
                            }
                        }
                    }
                }
                for (let parsePatternId=0; parsePatternId<parsePatterns.length; parsePatternId++) {
                    if (parsePatternIds.includes(parsePatternId)) {
                        continue;
                    }
                    newCsvInputArrayOfHashes.push({
                        parser: parser,
                        nodetype: parsePatterns[parsePatternId].nodeType,
                        tokenizepattern: '',
                        parsepattern: '(' + parsePatterns[parsePatternId].parsePattern.join(' ') + ')',
                        primitivetype: '',
                        nodegroup: '',
                        precedence: '',
                        subparser: ''
                    });
                }
                newCsvInputArrayOfHashes = this.testDerivedGrammar(sourceCodeString, parseTree, newCsvInputArrayOfHashes);
                if (newCsvInputArrayOfHashes) {
                    console.log('Solution found! Grammar produced identical parse tree!');
                    this.resetGrammarRules();
                    this.loadGrammarRules(newCsvInputArrayOfHashes);
                    return newCsvInputArrayOfHashes;
                } else {
//                    console.log('No solution, continue');
                }
            }
        }
        return null;
    }

    testDerivedGrammar(sourceCodeString, expectedParseTree, csvInputArrayOfHashes) {
        let drxTest = new DRegExp();
        drxTest.resetGrammarRules();
        drxTest.loadGrammarRules(csvInputArrayOfHashes);
        let tokenNodes = drxTest.tokenize(sourceCodeString);
        let options = {expectedParseTree: expectedParseTree};
        let resultParseTree = drxTest.parse(tokenNodes.slice(0), options);
        let seen = [];
        while(drxTest.errorParserGrammarRuleId != null) {
//            console.log('ValidParseSteps: ' + drxTest.validParseSteps);
            let grammarSerialized = JSON.stringify(drxTest.parserGrammarRuleIdsByParserAndPrecedenceGroup);
            if (seen.includes(grammarSerialized)) {
//                console.log('Loop detected, fixPrecedenceGroups resulted in previously seen state.');
                break;
            }
            seen.push(grammarSerialized);
            drxTest.fixPrecedenceGroups();
            resultParseTree = drxTest.parse(tokenNodes.slice(0), options);
        }
        if (drxTest.compareParseTrees(resultParseTree, expectedParseTree)) {
            return drxTest.exportGrammarRules();
        } else {
            return null;
        }
    }

    filterDups(csvInputArrayOfHashes) {
        let newCsvInputArrayOfHashes = [];
        for(let r1 of csvInputArrayOfHashes) {
            if (newCsvInputArrayOfHashes.some(r2 => r2.parser === r1.parser && r2.tokenizepattern === r1.tokenizepattern && r2.parsepattern === r1.parsepattern && r2.nodetype === r1.nodetype)) {
//                console.log('Skipping dup rule: ' + JSON.stringify(r1));
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
                    contexts[r.parser][r.parsepattern] = {leftcontext: {}, rightcontext: {}, resultNodeTypes: [], maxCount: 0, mostSelectiveContext: null};
                }
                for(let context of ['leftcontext','rightcontext']) {
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
        if (!isAmbiguous) {
            return csvInputArrayOfHashes;
        }
        let newCsvInputArrayOfHashes = [];
        for(let r of csvInputArrayOfHashes) {
            if (contexts[r.parser] && contexts[r.parser][r.parsepattern]) {
                let mostSelectiveContext = contexts[r.parser][r.parsepattern].mostSelectiveContext;
                if (r[mostSelectiveContext.contextSide] === mostSelectiveContext.contextNodeType && r.nodetype === mostSelectiveContext.resultNodeType) {
                    if (mostSelectiveContext.contextSide === 'leftcontext') {
                        r.parsepattern = r.leftcontext + ' ' + r.parsepattern;
//                        console.log('new left parsepattern: ' + r.parsepattern);
                        delete r.leftcontext;
                    } else if (mostSelectiveContext.contextSide === 'rightcontext') {
                        r.parsepattern = r.parsepattern + ' ' + r.rightcontext;
//                        console.log('new right parsepattern: ' + r.parsepattern);
                        delete r.rightcontext;
                    } else {
                        this.throwError('Unexpected contextSide: ' + mostSelectiveContext.contextSide);
                    }
                }
            }
            newCsvInputArrayOfHashes.push(r);
        }
        return this.fixContextSensitive(newCsvInputArrayOfHashes);
    }

    _deriveTokenizer(parser, parseTree, csvInputArrayOfHashes) {
        let nodeType = parseTree[0];
        let tokenizePattern;
        let parsePattern;
        if (typeof(parseTree[1]) === 'string') {
            tokenizePattern = this.tokenEscape(parseTree[1]);
        } else {
            let parsePatternNodeTypes = [];
            for (let i=0; parseTree[1][i]; i++) {
                let subTree = parseTree[1][i];
                this._deriveTokenizer(parser, subTree, csvInputArrayOfHashes);
            }
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
            }
        }

        // Inject new rule at beginning if necessary
        if (typeof(parseTree[1]) === 'string') {
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
                    subparser: ''
                };
                csvInputArrayOfHashes.push(rule);
            }
            rule.tokenizepatterns.push(tokenizePattern);
        }

        return;
    }

    _deriveParsePatterns(parser, parseTree, parsePatterns, leftContexts = [], rightContexts = []) {
        let nodeType = parseTree[0];
        if (Array.isArray(parseTree[1])) {
            let parsePatternNodeTypes = [];
            for (let i=0; parseTree[1][i]; i++) {
                let subTree = parseTree[1][i];
                parsePatternNodeTypes.push(subTree[0]);
                let subLeftContexts = [];
                for (let j=i-1; parseTree[1][j]; j--) {
                    subLeftContexts.push(parseTree[1][j][0]);
                }
                let subRightContexts = [];
                for (let j=i+1; parseTree[1][j]; j++) {
                    subRightContexts.push(parseTree[1][j][0]);
                }
                this._deriveParsePatterns(parser, subTree, parsePatterns, subLeftContexts, subRightContexts);
            }
            let match = false;
            for (let p of parsePatterns) {
                if (p.nodeType === nodeType && JSON.stringify(p.parsePattern) === JSON.stringify(parsePatternNodeTypes)) {
                    let contextMatch = false;
                    for (let c of p.contexts) {
                        if (contextMatch === false && JSON.stringify(c.left) === JSON.stringify(leftContexts) && JSON.stringify(c.right) === JSON.stringify(rightContexts)) {
                            contextMatch = true;
                            c.counter++;
                        }
                    }
                    if (contextMatch === false) {
                        p.contexts.push({left: leftContexts, right: rightContexts, counter: 1});
                    }
                    match = true;
                }
            }
            if (match === false) {
                parsePatterns.push({
                    nodeType: nodeType,
                    parsePattern: parsePatternNodeTypes,
                    contexts: [{left: leftContexts, right: rightContexts, counter: 1}]
                });
            }
        }
    }

    compareAndFixTokenizer(sourceCodeString, expectedTokens, csvInputArrayOfHashes) {
        this.resetGrammarRules();
        this.loadGrammarRules(csvInputArrayOfHashes);
        let resultTokens = this.tokenize(sourceCodeString);
        let isEqual = resultTokens.length == expectedTokens.length;
        let i;
//        console.log('resultTokens:' + JSON.stringify(resultTokens,null,4));
//        console.log('expectedTokens:' + JSON.stringify(expectedTokens,null,4));
        for (i = 0; resultTokens[i] && expectedTokens[i]; i++) {
            if (resultTokens[i][0] != expectedTokens[i][0]) {
//                console.log('resultTokens[i][0] != expectedTokens[i][0]: ' + i + ' ' + resultTokens[i][0] + ' ' + expectedTokens[i][0]);
                isEqual = false;
                break;
            }
            if (resultTokens[i][1] != expectedTokens[i][1]) {
                this.throwError('nodeType ' + resultTokens[i][0] + ' is correct but literal differs: "' + resultTokens[i][1] + '" vs "' + expectedTokens[i][1] + '"');
            }
        }
        if (isEqual) {
//            console.log('OK csvInputArrayOfHashes');
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
            this.throwError('dregexp nodeType ' + resultTokens[i][0] + ' not found in csvInputArrayOfHashes');
        }
        if (expectedToken == undefined) {
            this.throwError('expectedToken nodeType ' + expectedTokens[i][0] + ' not found in csvInputArrayOfHashes');
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
            this.throwError('ERROR Unexpected: parseTree1: ' + JSON.stringify(parseTree1) + ' parseTree2: ' + JSON.stringify(parseTree2));
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
        let errorRule = this.parserGrammarRules[this.errorParserGrammarRuleId];
        console.log('Lowering precedence of rule: ' + errorRule.nodetype + ' ::= ' + errorRule.parsepattern);
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
                            this.throwError('Duplicate parserGrammarRuleId ' + parserGrammarRuleId.toString());
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
//        console.log(JSON.stringify(newParserGrammarRuleIdsByParserAndPrecedenceGroup));
        this.parserGrammarRuleIdsByParserAndPrecedenceGroup = newParserGrammarRuleIdsByParserAndPrecedenceGroup;
        this.errorParserGrammarRuleId = null;
    }

}

module.exports = DRegExp;
