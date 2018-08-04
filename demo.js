'use strict';

var drxExpected = new DRegExp();
var drxActual = new DRegExp();

function updateTables() {
        let expectedData = [];

        for (let rule of drxExpected.exportGrammarRules()) {
            expectedData.push([rule.parser, rule.nodetype, rule.tokenizepattern, rule.parsepattern, rule.primitivetype, rule.nodegroup, rule.precedence, rule.subparser]);
        }

        $('#expectedGrammar').jexcel({
            data:expectedData,
            colWidths: [ 100, 100, 100, 300, 100, 100, 100, 100],
            colHeaders: [ 'parser', 'nodeType', 'tokenizePattern', 'parsePattern', 'primitiveType', 'nodeGroup', 'precedence', 'subParser' ]
        });

        let actualData = [];

        for (let rule of drxActual.exportGrammarRules()) {
            actualData.push([rule.parser, rule.nodetype, rule.tokenizepattern, rule.parsepattern, rule.primitivetype, rule.nodegroup, rule.precedence, rule.subparser]);
        }

        $('#actualGrammar').jexcel({
            data:actualData,
            colWidths: [ 100, 100, 100, 300, 100, 100, 100, 100],
            colHeaders: [ 'parser', 'nodeType', 'tokenizePattern', 'parsePattern', 'primitiveType', 'nodeGroup', 'precedence', 'subParser' ]
        });

}

function updateChart(containerId, parseTree) {
        // The code below is only necessary to draw the tree diagram
        // using the third-party library Treant.js
        // from http://fperucic.github.io/treant-js/
        function createTreantNodeStructure(parseTree) {
            let node = {
                text: { name: parseTree[0] }
            };
            if (parseTree[1].constructor === Array) {
                let children = [];
                for (let child of parseTree[1]) {
                    children.push(createTreantNodeStructure(child));
                }
                node.children = children;
            } else {
                node.children = [
                    {text: { name: parseTree[1] }}
                ];
            }
            return node;
        }
        let simple_chart_config = {
            chart: {
                container: containerId,
                node: {
                    collapsable: true
                }
            },
            nodeStructure: createTreantNodeStructure(parseTree)
        };
        new Treant( simple_chart_config );
}

function parseAndDrawTree() {

        let inputString = document.getElementById('inputString').value;
        console.log('inputString: ' + inputString);

        let expectedTokenNodes = drxExpected.tokenize(inputString);

        let expectedParseTree = drxExpected.parse(expectedTokenNodes.slice(0));

        updateChart('#expectedParseTree', expectedParseTree);

        let parser = expectedParseTree[0];
        let csvInputArrayOfHashes = [];
        csvInputArrayOfHashes = drxActual.deriveGrammar(inputString, expectedParseTree, csvInputArrayOfHashes);

        let actualTokenNodes = drxActual.tokenize(inputString);
        let options = {expectedParseTree: expectedParseTree};

        let actualParseTree = drxActual.parse(actualTokenNodes.slice(0), options);
        let seen = [];
        while(drxActual.errorParserGrammarRuleId != null) {
            console.log('ValidParseSteps: ' + drxActual.validParseSteps);
            let grammarSerialized = JSON.stringify(drxActual.parserGrammarRuleIdsByParserAndPrecedenceGroup);
            if (seen.includes(grammarSerialized)) {
                console.log('Loop detected, fixPrecedenceGroups resulted in previously seen state.');
                break;
            }
            seen.push(grammarSerialized);
            drxActual.fixPrecedenceGroups();
            actualParseTree = drxActual.parse(actualTokenNodes.slice(0), options);
        }
        updateChart('#actualParseTree', actualParseTree);

        let debugInfo = [];
        drxActual.compareParseTrees(actualParseTree, expectedParseTree, debugInfo);
        document.getElementById('debugInfo').innerHTML
            = (debugInfo.length == 0 ? 'OK' : JSON.stringify(debugInfo))
            + '<br/>' + drxActual.numNodes + ' nodes'
            + '<br/>' + drxActual.maxNodes + ' max nodes';

        updateTables();

}

Papa.parse('grammars/json.csv', {
    header: true,
    download: true,
    complete: function(results) {
        drxExpected.loadGrammarRules(results.data);
        updateTables();
    }
});
