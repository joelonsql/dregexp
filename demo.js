let inputString = '{"foo":123, "bar": {"abc":true, "def":[10,20,30]} }';
let nodeTypes = [];
let nodeTypeIds = {};
let literalPatterns = {};
let expandedLiteralPatterns = {};
let nodePatterns = {};
let expandedNodePatterns = {};
let nodes = [];

// Unbroken sequence of >10000 ideograms starting at this unicode char code:
let firstNodeTypeCharCode = 44032;

Papa.parse('http://localhost/~joel/dregexp/node_types.csv', {
    header: true,
    download: true,
    complete: function(results) {
        parse(results);
    }
});

function parse(grammar) {
    console.log('inputString: ' + inputString);
    let nodeTypeId = 0;
    for (let rule of grammar.data) {
        if (nodeTypes.includes(rule.nodetype)) {
            console.error('nodeType ' + rule.nodetype + ': defined more than once');
            return false;
        } else if (!rule.nodetype.match(/^[A-Za-z_]+$/)) {
            console.error('nodeType ' + rule.nodetype + ': contains invalid characters');
            return false;
        } else {
            nodeTypes.push(rule.nodetype);
            nodeTypeIds[rule.nodetype] = nodeTypeId;
            nodeTypeId++;
        }

        if (rule.literalpattern.length > 0 && rule.nodepattern.length > 0) {
            console.error('nodeType ' + rule.nodetype + ': only one of literalpattern or nodepattern must be defined, not both');
            return false;
        } else if (rule.literalpattern.length > 0) {
            literalPatterns[rule.nodetype] = rule.literalpattern;
        } else if (rule.nodepattern.length > 0) {
            nodePatterns[rule.nodetype] = rule.nodepattern;
        } else {
            console.error('nodeType ' + rule.nodetype + ': literalpattern or nodepattern must be defined');
            return false;
        }
    }

    for (let nodeType in nodePatterns) {
        let matchNodeTypes = nodePatterns[nodeType].match(/[A-Za-z_]{2,}/g);
        for (let tokenNodeType of matchNodeTypes) {
            if (literalPatterns[tokenNodeType] && !expandedLiteralPatterns[tokenNodeType]) {
                expandedLiteralPatterns[tokenNodeType] = expandLiteralPattern(tokenNodeType);
            }
        }
    }

    let tokenNodeTypes = [];
    let tokenRegexes = [];
    for (let nodeType of nodeTypes) {
        if (!expandedLiteralPatterns[nodeType]) {
            continue;
        }
        tokenNodeTypes.push(nodeType);
        tokenRegexes.push(expandedLiteralPatterns[nodeType]);
    }
    let tokenizerCaptureGroupsRegexp = '^(?:(' + tokenRegexes.join(')|(') + '))';
    let re = new RegExp(tokenizerCaptureGroupsRegexp);

    let parserNodeTypes = [];
    for (let nodeType of nodeTypes) {
        if (!nodePatterns[nodeType]) {
            continue;
        }
        parserNodeTypes.push(nodeType);
        expandedNodePatterns[nodeType] = expandNodePattern(nodeType);
    }

    console.log('TOKENIZE:');
    let nodeId = 0;
    let nodeString = '';
    while (inputString.length > 0) {
        let m = inputString.match(re);
        if (m == null) {
            console.error('unable to tokenize: ' + inputString);
            return false;
        }
        let matched = false;
        for (let i=0; i < tokenNodeTypes.length; i++) {
            if (m[i+1] != null) {
                if (matched) {
                    console.error('multiple capture groups matched: ' + tokenNodeTypes[i]);
                    return false;
                }
                console.log(tokenNodeTypes[i] +  " " + m[i+1]);
                nodes[nodeId] = [tokenNodeTypes[i], m[i+1]];
                nodeString += String.fromCharCode(firstNodeTypeCharCode + nodeTypeIds[tokenNodeTypes[i]]) + nodeId + ',';
                nodeId++;
                matched = true;
                inputString = inputString.slice(m[i+1].length);
            }
        }
    }

    console.log('PARSE:');
    console.log('start nodeString: ' + nodeString);
    for (let didWork = true; didWork; ) {
        didWork = false;
        for (let nodeType of parserNodeTypes) {
            let re = new RegExp(expandedNodePatterns[nodeType]);
            let m = nodeString.match(re);
            if (m == null) {
                continue;
            }
            // TODO: Should verify that only m[1] is defined,
            // i.e. that only a single capture group matched,
            // in case of an error by the user who could have
            // defined multiple capture groups in the nodepattern.
            let subNodeString = m[1];
            nodeString = nodeString.replace(subNodeString, String.fromCharCode(firstNodeTypeCharCode + nodeTypeIds[nodeType]) + nodeId + ',');
            let subNodes = [];
            while (subNodeString.length > 0) {
                let subNode = subNodeString.match(/([가-판])(\d+),/u); // [가-판] is the 10000 unicode chars between 44032..54032
                if (subNode == null) {
                    console.error('unable to parse: ' + subNodeString);
                    return false;
                }
                let subNodeType = nodeTypes[subNode[1].charCodeAt(0) - firstNodeTypeCharCode];
                let subNodeId = subNode[2];
                subNodes.push(nodes[subNodeId]);
                subNodeString = subNodeString.replace(subNode[0], '');
                console.log(subNodeType + subNodeId + ' -> ' + nodeType + nodeId);
            }
            nodes[nodeId] = [nodeType, subNodes];
            nodeId++;
            didWork = true;
            break;
        }
    }
    nodeId--; // to get nodeId for final node
    console.log('final nodeString: ' + nodeString);
    console.log('final nodeId ' + nodeId);

    if (nodeString.match(new RegExp('^' + String.fromCharCode(firstNodeTypeCharCode + nodeTypes.length - 1) + nodeId + ',$'))) {
        console.log('OK, final single node is of nodeType ' + nodeTypes[nodeTypes.length - 1]);
        console.log(nodes[nodeId]);
    } else {
        console.error('Parser error, expected final single node to be of nodeType ' + nodeTypes[nodeTypes.length - 1]);
    }

}

function expandLiteralPattern(tokenNodeType) {
    let literalPattern = literalPatterns[tokenNodeType];
    let tokenNodeTypes = literalPattern.match(/[A-Za-z_]{2,}/g);
    if (tokenNodeTypes) {
        for (let subTokenNodeType of tokenNodeTypes) {
            literalPattern = literalPattern.replace(new RegExp(subTokenNodeType, 'g'), expandLiteralPattern(subTokenNodeType));
        }
    }
    literalPattern = literalPattern.replace(/\s+/g, '');
    return literalPattern;
}

function expandNodePattern(parserNodeType) {
    let nodePattern = nodePatterns[parserNodeType];
    let bracketExpressions = nodePattern.match(/\[[A-Za-z_]{2,}(?:\s+[A-Za-z_]{2,})*\]/g);
    if (bracketExpressions) {
        for (let bracketExpression of bracketExpressions) {
            let expandedBracketExpression = '';
            let bracketNodeTypes = bracketExpression.match(/[A-Za-z_]{2,}/g);
            for (let bracketNodeType of bracketNodeTypes) {
                expandedBracketExpression += String.fromCharCode(firstNodeTypeCharCode + nodeTypeIds[bracketNodeType]);
            }
            nodePattern = nodePattern.replace(bracketExpression, '[' + expandedBracketExpression + ']\\d+,')
        }
    }
    let subNodeTypes = nodePattern.match(/[A-Za-z_]{2,}/g);
    if (subNodeTypes) {
        for (let subNodeType of subNodeTypes) {
            nodePattern = nodePattern.replace(subNodeType, '(?:' + String.fromCharCode(firstNodeTypeCharCode + nodeTypeIds[subNodeType]) + '\\d+,)');
        }
    }
    nodePattern = nodePattern.replace(/\s+/g, '');
    return nodePattern;
}
