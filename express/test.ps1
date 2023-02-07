param([switch]$showJson)

# if we ran the script from a location other than the script's directory
# then launch a new PS process to run the script in the script directory 
$curLoc = get-location
if (-NOT ($PSScriptRoot -eq $curLoc)) {
    $arguments = "-NoProfile & '" + $myinvocation.mycommand.definition + "'"
    Start-Process powershell -ArgumentList $arguments -WorkingDirectory $PSScriptRoot -nonewWindow -wait
    break;
}

dotnet tool restore
if (-not $?) { break }
dotnet neoxp reset -f
if (-not $?) { break }
dotnet neoxp contract deploy ./contract.nef genesis
if (-not $?) { break }

dotnet neoxp contract run test-contract get -r -j
dotnet neoxp contract storage test-contract -j 
echo ""
dotnet neoxp contract run test-contract set "test"  -a genesis
dotnet neoxp contract run test-contract get -r -j
dotnet neoxp contract storage test-contract -j
echo ""
dotnet neoxp contract run test-contract remove -a genesis
dotnet neoxp contract run test-contract get -r -j
dotnet neoxp contract storage test-contract -j
echo ""