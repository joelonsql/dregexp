'use strict';

Papa.parse('http://localhost/~joel/dregexp/node_types.csv', {
    header: true,
    download: true,
    complete: function(results) {

        let drx = new DRegExp(results.data);

        let inputString = '{"foo":123, "bar": {"abc":true, "def":[10,20,30]} }';
        console.log('inputString: ' + inputString);

        let nodeString = drx.tokenize(inputString);
        console.log('nodeString: ' + nodeString);

        let AST = drx.parse(nodeString);
        console.log(AST);

    }
});
