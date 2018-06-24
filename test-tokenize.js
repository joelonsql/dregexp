#!/usr/local/bin/node
let fs = require('fs');
let DRegExp = require('./dregexp');
let Papa = require('./papaparse');

let csvGrammarFile = process.argv[2];
let inputDataFile = process.argv[3];
let debug = process.argv[4];

if (inputDataFile && inputDataFile.match(/\.tokens$/)) {
    inputDataFile = inputDataFile.replace(/\.tokens$/,'');
}

let tokensFile = inputDataFile + '.tokens';

if (csvGrammarFile == null || inputDataFile == null) {
    console.log('Usage: test-tokenize.js [csv grammar file] [input file]');
    return;
} else if (!fs.existsSync(csvGrammarFile)) {
    console.error('File does not exist: ' + csvGrammarFile);
    return;
} else if (!fs.existsSync(inputDataFile)) {
    console.error('File does not exist: ' + inputDataFile);
    return;
} else if (!fs.existsSync(tokensFile)) {
    console.error('File does not exist: ' + tokensFile);
    return;
}

let inputData = fs.readFileSync(inputDataFile, 'utf8');
let expectedTokens = JSON.parse(fs.readFileSync(tokensFile, 'utf8'));

let drx = new DRegExp({'debug': debug});

drx.loadGrammarRules(Papa.parse(fs.readFileSync(csvGrammarFile, 'utf8'), {header: true}).data);
let tokens = drx.tokenize(inputData);

let concattedTokens = '';
let resultTokens = [];
for (let t of tokens) {
    concattedTokens += t[1];
    if (t[0].match(/^(WhiteSpace|LineComment|BlockComment)$/)) {
        continue;
    }
    resultTokens.push(t);
}

if (JSON.stringify(expectedTokens) == JSON.stringify(resultTokens)) {
    console.log(inputDataFile + ' OK, same tokens');
} else {
    console.error(inputDataFile + ' ERROR:');
    let strOK = '';
    while (true) {
        let t1 = expectedTokens.shift();
        let t2 = resultTokens.shift();
        if (!t1 && !t2) {
            process.exit(1);
        } else if (JSON.stringify(t1) == JSON.stringify(t2)) {
            console.log(JSON.stringify(t1) + ' == ' + JSON.stringify(t2));
//            strOK += JSON.stringify(t1) + ' == ' + JSON.stringify(t2) + "\n";
        } else {
//            console.log("***\n" + strOK.substr(strOK.length-1000,1000) + (t1[1].length > t2[1].length ? t1[1] : t2[1]) + "\n***");
            console.log(JSON.stringify(t1) + ' != ' + JSON.stringify(t2));
//            process.exit(1);
        }
    }
}

if (concattedTokens == inputData) {
    console.log(inputDataFile + ' OK, tokens concatted is equal to file content');
    fs.writeFileSync(tokensFile + '.verified', JSON.stringify(tokens));
} else {
    console.error(inputDataFile + ' ERROR: tokens concatted not equal to file content');
}



