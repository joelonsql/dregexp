'use strict';

var drx;

function parseAndDrawTree() {
        let inputString = document.getElementById('inputString').value;
        console.log('inputString: ' + inputString);

        let tokenNodes = drx.tokenize(inputString);
        console.log('tokenNodes: ' + tokenNodes);

        let parseTree = drx.parse(tokenNodes);
        console.log(parseTree);

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
                container: "#OrganiseChart-simple",
                node: {
                    collapsable: true
                }
            },
            nodeStructure: createTreantNodeStructure(parseTree)
        };
        new Treant( simple_chart_config );
}

Papa.parse('node_types.csv', {
    header: true,
    download: true,
    complete: function(results) {
        drx = new DRegExp(results.data);
        parseAndDrawTree();
        let data = [];
        for (let rule of results.data) {
            data.push([rule.nodetype, rule.tokenizepattern, rule.parsepattern]);
        }
        $('#mytable').jexcel({ data:data, colWidths: [ 300, 500, 500 ] });
        $('#reloadGrammar').on('click', function () {
            let data = $('#mytable').jexcel('getData');
            console.log('jExcel:');
            console.log(data);
            let newGrammar = [];
            for (let row of data) {
                newGrammar.push({nodetype: row[0], tokenizepattern: row[1], parsepattern: row[2]});
            }
            drx = new DRegExp(newGrammar);
            parseAndDrawTree();
        })
    }
});
