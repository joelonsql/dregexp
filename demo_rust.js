'use strict';

var drx = new DRegExp();

function updateTable() {
    let data = [];
    for (let rule of drx.grammarRules) {
        data.push([rule.parser, rule.nodetype, rule.tokenizepattern, rule.parsepattern, rule.primitivetype, rule.nodegroup, rule.precedence, rule.subparser]);
    }
    $('#mytable').jexcel({
        data:data,
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
        fetch("http://127.0.0.1:3000/", {
            method: "POST", 
            body: inputString
        }).then(function(response) {
            return response.json();
        }).then(function(rustcParseTree) {
            updateChart('#parseTree2', rustcParseTree);
            let parser = rustcParseTree[0];
            let csvInputArrayOfHashes = [
                {
                    parser: parser,
                    nodetype: 'WS',
                    tokenizepattern: '\\s+',
                    parsepattern: '',
                    primitivetype: '',
                    nodegroup: '',
                    precedence: '',
                    subparser: '',
                },
                {
                    parser: parser,
                    nodetype: 'LineComment',
                    tokenizepattern: '//.*',
                    parsepattern: '',
                    primitivetype: '',
                    nodegroup: '',
                    precedence: '',
                    subparser: '',
                },
                {
                    parser: parser,
                    nodetype: 'BlockComment',
                    tokenizepattern: '/\\*[\\s\\S]*?\\*/',
                    parsepattern: '',
                    primitivetype: '',
                    nodegroup: '',
                    precedence: '',
                    subparser: '',
                },
            ];
            csvInputArrayOfHashes = drx.deriveGrammar(inputString, rustcParseTree, csvInputArrayOfHashes);
            let tokenNodes = drx.tokenize(inputString);
            let parseTree = drx.parse(tokenNodes);
            updateChart('#parseTree', parseTree);
            updateTable();
            console.log('FOOBAR');
            let debugInfo = [];
            drx.compareParseTrees(parseTree, rustcParseTree, debugInfo);
            document.getElementById('debugInfo').innerHTML
                = (debugInfo.length == 0 ? 'OK' : JSON.stringify(debugInfo))
                + '<br/>' + drx.numNodes + ' nodes'
                + '<br/>' + drx.maxNodes + ' max nodes';
        });
}
