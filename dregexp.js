class DRegExp {

    constructor(flags = {}) {
        this.firstNodeTypeCharCode = 44032; // Unbroken sequence of >10000 ideograms starting at this unicode char code
        this.flags = flags;
        this.resetGrammarRules();
    }

    resetGrammarRules() {
        this.nodeTypes = ['?']; // the first nodeType is a special one for unrecognized characters
        this.nodeTypeIds = {'?':0};
        this.nodeGroups = {};
        this.grammarRules = {};
        this.tokenizerNodeTypes = [];
        this.parserNodeTypes = {};
        this.mainParser = null;
        this.numNodes = 0;
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
        this.tokenizerUnusedNodeTypes = {};
        this.parserNodeTypes = {};
        let tokenizerNodeTypes = {};
        let tokenizerUnusedNodeTypes = {};
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
            if (rule.tokenizepattern && rule.tokenizepattern.length > 0) {
                allTokenizeNodeTypes.push(nodeType);
                tokenizeSubNodeTypes = this.extractNodeTypes(tokenizeSubNodeTypes, rule.tokenizepattern);
                if (!tokenizerNodeTypes.hasOwnProperty(parser)) {
                    tokenizerNodeTypes[parser] = [];
                    tokenizerUnusedNodeTypes[parser] = [];
                }
            }
            if (rule.parsepattern && rule.parsepattern.length > 0) {
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
                    tokenizerNodeTypes[parser].push(nodeType);
                    tokenizerUnusedNodeTypes[parser].push(nodeType);
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
        this.tokenizerUnusedNodeTypes = tokenizerUnusedNodeTypes;
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
        let captureGroups = {};
        let offset = 1;
        let i = 0;
        for (let nodeType of this.tokenizerNodeTypes[parser]) {
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

    parseRegExp(nodeTypes, errorRecovery) {
        let parseRegexes = [];
        for (let nodeType of nodeTypes) {
            parseRegexes.push(this.expandParsePattern(nodeType, errorRecovery));
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
        if (!this.tokenizerNodeTypes.hasOwnProperty(parser)) {
            throw new Error('no rules defined for parser: ' + parser);
        }
        let tokenizerNodeTypes = this.tokenizerNodeTypes[parser];
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
                this.tokenNodes.push(['?', invalidString]);
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
                let subParser = this.grammarRules[nodeType].subparser;
                if (subParser) {
                    this._tokenize(matchedStr, Object.assign(options, {parser: subParser}));
                } else if (!this.tokenizerUnusedNodeTypes[parser].includes(nodeType)) {
                    this.tokenNodes.push([nodeType, matchedStr]);
                }
            }
        }
        if (inputString.length > lastIndex) {
            let invalidString = inputString.slice(lastIndex, inputString.length);
            if (options.throwOnError) {
                throw new Error('unable to tokenize at pos ' + lastIndex + ' : "' + invalidString + '"');
            }
            this.tokenNodes.push(['?', invalidString]);
        }
    }

    parse(tokenNodes, options = {}) {
        let parser = options.parser || this.mainParser;
        if (!this.parserNodeTypes.hasOwnProperty(parser)) {
            throw new Error('no rules defined for parser: ' + parser);
        }
        let nodeString = '';
        let nodeId = 0;
        let errorRecovery = '';
        for (let node of tokenNodes) {
            nodeString += this.encodeNodeType(node[0]) + nodeId++ + ',';
            if (node[0] == '?' && !options.throwOnError) {
                errorRecovery = '(?:' + this.encodeNodeType('?') + '\\d+,)?';
            }
        }
        console.log('nodeString: ' + nodeString);
        for (let didWork = true; didWork; ) {
            didWork = false;
            for (let percedenceGroup of this.parserNodeTypes[parser]) {
                let nodeType = null;
                let re = this.parseRegExp(percedenceGroup.nodeTypes, errorRecovery);
                let m;
                let lastIndex = 0;
                let newNodeString = '';
                while (m = re.exec(nodeString)) {
                    if (m.length != percedenceGroup.nodeTypes.length + 1) {
                        throw new Error('different number of capture groups than node types for given precedence');
                    } else if (m.index > lastIndex) {
                        newNodeString += nodeString.slice(lastIndex, m.index);
                    }
                    lastIndex = re.lastIndex;
                    let matched = false;
                    let matchedStr = m[0];
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
                    matchedStr = matchedStr.replace(subNodeString, this.encodeNodeType(nodeType) + nodeId + ',');
                    newNodeString += matchedStr;
                    let subNodes = [];
                    let subLastIndex = 0;
                    let subNode;
                    let subRegexp = /([가-판])(\d+),/ug; // [가-판] is the 10000 unicode chars between this.firstNodeTypeCharCode=44032..54032
                    while (subNode = subRegexp.exec(subNodeString)) {
                        if (subNode.index > subLastIndex) {
                            throw new Error('did not match immediately after previous match');
                        }
                        let subNodeType = this.decodeNodeType(subNode[1]);
                        let subNodeId = subNode[2];
                        subNodes.push(tokenNodes[subNodeId]);
                        subLastIndex = subRegexp.lastIndex;
                    }
                    if (subNodes.length == 0) {
                        throw new Error('unable to parse: ' + subNodeString);
                    }
                    let subParser = this.grammarRules[nodeType].subparser;
                    if (subParser) {
                        tokenNodes[nodeId++] = this.parse(subNodes, Object.assign(options, {parser: subParser}));
                    } else {
                        tokenNodes[nodeId++] = [nodeType, subNodes];
                    }
                    if (this.maxNodes && nodeId >= this.maxNodes) {
                        didWork = false;
                        break;
                    }
                    didWork = true;
                    break; // FIXME while() should be eliminated
                }
                if (lastIndex > 0) {
                    if (nodeString.length > lastIndex) {
                        newNodeString += nodeString.slice(lastIndex, nodeString.length);
                    }
                    nodeString = newNodeString;
                }
                if (this.maxNodes && nodeId >= this.maxNodes) {
                    didWork = false;
                    break;
                }
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
        this._deriveGrammar(parser, parseTree, csvInputArrayOfHashes);
        for(let r of csvInputArrayOfHashes) {
            if (r.tokenizepatterns) {
                if (r.tokenizepatterns.length > 0) {
                    r.tokenizepattern = r.tokenizepatterns.join('|');
                }
                delete r.tokenizepatterns;
            }
            if (r.parsepatterns) {
                if (r.parsepatterns.length > 0) {
                    r.parsepattern = '(' + r.parsepatterns.join('|') + ')';
                }
                delete r.parsepatterns;
            }
        }
        let tokens = this.unparseWithPaths(parseTree);
        csvInputArrayOfHashes = this.compareAndFixTokenizer(sourceCodeString, tokens, csvInputArrayOfHashes);
        return csvInputArrayOfHashes;
    }

    _deriveGrammar(parser, parseTree, csvInputArrayOfHashes) {
        let nodeType = parseTree[0];
        let rule;
        for (let r of csvInputArrayOfHashes) {
            if (r.nodetype == nodeType) {
                rule = r;
                break;
            }
        }
        if (rule == undefined) {
            rule = {
                parser: parser,
                nodetype: nodeType,
                tokenizepatterns: [],
                tokenizepattern: '',
                parsepatterns: [],
                parsepattern: '',
                primitivetype: '',
                nodegroup: '',
                precedence: '',
                subparser: ''
            };
            csvInputArrayOfHashes.unshift(rule);
        }
        if (typeof(parseTree[1]) === 'string') {
            let pat = this.tokenEscape(parseTree[1]);
            if (!rule.tokenizepatterns.includes(pat)) {
                rule.tokenizepatterns.push(pat);
            }
        } else {
            let parsePatterns = [];
            for (let subTree of parseTree[1]) {
                parsePatterns.push(subTree[0]);
                this._deriveGrammar(parser, subTree, csvInputArrayOfHashes);
            }
            let pat = parsePatterns.join(' ');
            if (!rule.parsepatterns.includes(pat) && pat != nodeType ) {
                rule.parsepatterns.push(pat);
            }
        }
    }

    compareAndFixTokenizer(sourceCodeString, expectedTokens, csvInputArrayOfHashes) {
        console.log('compareAndFixTokenizer: ' + JSON.stringify({
            sourceCodeString: sourceCodeString,
            expectedTokens: expectedTokens,
            csvInputArrayOfHashes: csvInputArrayOfHashes
        },null,4));
        this.resetGrammarRules();
        this.loadGrammarRules(csvInputArrayOfHashes);
        let resultTokens = this.tokenize(sourceCodeString);
        console.log('result tokens: ' + resultTokens.length + ' ' + JSON.stringify(resultTokens,null,4));
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

    unparseWithPaths(parseTree, path = [], tokens = []) {
        if (typeof(parseTree[1]) === 'string') {
            tokens.push([parseTree[0], parseTree[1], path]);
        } else {
            let nodeType = parseTree[0];
            path.unshift(nodeType);
            for (let node of parseTree[1]) {
                this.unparseWithPaths(node, path.slice(0), tokens);
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


}

module.exports = DRegExp;
