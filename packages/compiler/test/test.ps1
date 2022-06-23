param([switch]$showJson)

neoxp reset -f
neoxp contract deploy ./contract.nef genesis

function Parse-Result($json) {
    $result = $json | ConvertFrom-Json
    $result = [Convert]::FromBase64String($result.stack[0].value)
    [System.Text.Encoding]::UTF8.GetString($result)
}

$r = neoxp contract run test-contract helloWorld --results --json
echo "contract run test-contract helloWorld Result:   $(Parse-Result $r)"
if ($showJson) { echo $r }

$r = neoxp contract run test-contract sayHello Neo --results --json
echo "contract run test-contract sayHello Neo Result: $(Parse-Result $r)"
if ($showJson) { echo $r }
