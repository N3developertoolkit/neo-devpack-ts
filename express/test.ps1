param([switch]$showJson)

# if we ran the script from a location other than the script's directory
# then launch a new PS process to run the script in the script directory 
$curLoc = get-location
if (-NOT ($PSScriptRoot -eq $curLoc)) {
    $arguments = "-NoProfile & '" + $myinvocation.mycommand.definition + "'"
    Start-Process powershell -ArgumentList $arguments -WorkingDirectory $PSScriptRoot -nonewWindow -wait
    break;
}

neoxp reset -f
if (-not $?) { break }
neoxp contract deploy out/contract.nef genesis 
if (-not $?) { break }

# function Parse-Result($json) {
#     $result = $json | ConvertFrom-Json
#     $result = [Convert]::FromBase64String($result.stack[0].value)
#     [System.Text.Encoding]::UTF8.GetString($result)
# }

# function get-storages {
#     $s = neoxp contract storage TestContract --json | ConvertFrom-Json
#     $s.storages
# }

# $r = neoxp contract run TestContract helloWorld --results --json
# echo "contract run test-contract helloWorld Result:   $(Parse-Result $r)"
# if ($showJson) { echo $r }

# $r = neoxp contract run TestContract sayHello Neo --results --json
# echo "contract run test-contract sayHello Neo Result: $(Parse-Result $r)"
# if ($showJson) { echo $r }

# $s1 = get-storages
# echo "Before: $($s1 | ConvertTo-json)"

# $r = neoxp contract run TestContract setValue devhawk -a genesis -j

# $s2 = get-storages
# echo "After: $($s2 | ConvertTo-json)"

# # [System.Text.Encoding]::UTF8.GetString([Convert]::FromHexString($s.storages.value.substring(2)))