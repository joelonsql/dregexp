'use strict';

Papa.parse('node_types.csv', {
    header: true,
    download: true,
    complete: function(results) {

        let drx = new DRegExp(results.data);

        let inputString = '{"foo":"bar"}';
        console.log('inputString: ' + inputString);

        let tokenNodes = drx.tokenize(inputString);
        console.log('tokenNodes: ' + tokenNodes);

        let parseTree = drx.parse(tokenNodes);
        console.log(parseTree);

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
});
