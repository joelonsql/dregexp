'use strict';

var drx = new DRegExp();

function updateTable() {
        let data = [];
        for (let nodeType of drx.nodeTypes) {
            console.log(nodeType);
            if (nodeType == '?') {
                continue;
            }
            let rule = drx.grammarRules[nodeType];
            data.push([rule.parser, rule.nodetype, rule.tokenizepattern, rule.parsepattern, rule.primitivetype, rule.nodegroup, rule.precedence, rule.subparser]);
        }
        $('#mytable').jexcel({
            data:data,
            colWidths: [ 100, 100, 100, 300, 100, 100, 100, 100],
            colHeaders: [ 'parser', 'nodeType', 'tokenizePattern', 'parsePattern', 'primitiveType', 'nodeGroup', 'precedence', 'subParser' ]
        });
}

function parseAndDrawTree() {

        let inputString = document.getElementById('inputString').value;
        let eliminateUselessNodes = document.getElementById('eliminateUselessNodes').checked;
        console.log('inputString: ' + inputString);

        let tokenNodes = drx.tokenize(inputString);
        console.log('tokenNodes: ' + tokenNodes);

        let parseTree = ['Rust', tokenNodes];

        // let parseTree = drx.parse('Rust', tokenNodes);
        // if (eliminateUselessNodes) {
        //     parseTree = drx.eliminateNodes(parseTree);
        // }
        // console.log('parseTree:');
        // console.log(parseTree);

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
                container: "#parseTree",
                node: {
                    collapsable: true
                }
            },
            nodeStructure: createTreantNodeStructure(parseTree)
        };
        new Treant( simple_chart_config );
}

Papa.parse('grammars/rust.csv', {
    header: true,
    download: true,
    complete: function(results) {
        drx.loadGrammarRules(results.data);
        updateTable();
    }
});
