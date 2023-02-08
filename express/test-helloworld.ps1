param([switch]$showJson)

# if we ran the script from a location other than the script's directory
# then launch a new PS process to run the script in the script directory 
$curLoc = get-location
if (-NOT ($PSScriptRoot -eq $curLoc)) {
    $arguments = "-NoProfile & '" + $myinvocation.mycommand.definition + "'"
    Start-Process powershell -ArgumentList $arguments -WorkingDirectory $PSScriptRoot -nonewWindow -wait
    break;
}

if (-not (test-path ./out/helloworld.nef)) {
    throw "contract file missing"
}

dotnet tool restore
if (-not $?) { break }
dotnet neoxp reset -f
if (-not $?) { break }
dotnet neoxp contract deploy ./out/helloworld.nef genesis
if (-not $?) { break }

dotnet neoxp contract run helloworld get -r -j
dotnet neoxp contract storage helloworld -j 
echo ""
dotnet neoxp contract run helloworld set "test"  -a genesis
dotnet neoxp contract run helloworld get -r -j
dotnet neoxp contract storage helloworld -j
echo ""
dotnet neoxp contract run helloworld remove -a genesis
dotnet neoxp contract run helloworld get -r -j
dotnet neoxp contract storage helloworld -j
echo ""