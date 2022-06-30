const cp = require('child_process');

console.log(execSync("neoxp reset -f"));
console.log(execSync("neoxp contract deploy ./contract.nef genesis"));

runCmd("test-contract helloWorld");
runCmd("test-contract sayHello Neo");

function runCmd(cmd) {
    const result = execSync(`neoxp contract run ${cmd} --results --json`);
    const json = JSON.parse(result);
    const value = Buffer.from(json.stack[0].value, 'base64').toString('utf8');
    console.log(`${cmd}: ${value}`);
}

function execSync(cmd) {
    return cp.execSync(cmd, { cwd: __dirname }).toString()
}
