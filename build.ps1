$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
$taskHtml = Get-Content -LiteralPath (Join-Path $taskRoot 'source.template.html') -Raw -Encoding UTF8
if ($taskHtml.Contains('<!--GAME_CODE-->')) {
    $taskGame = Get-Content -LiteralPath (Join-Path $taskRoot 'game.js') -Raw -Encoding UTF8
    $taskHtml = $taskHtml.Replace('<!--GAME_CODE-->', '<script>' + $taskGame.Replace('</script', '<\/script') + '</script>')
}
$taskSpec = Get-Content -LiteralPath (Join-Path $taskRoot 'assets.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$taskRecords = [ordered]@{}
foreach ($taskProp in $taskSpec.PSObject.Properties) {
    $taskPath = Join-Path $taskRoot $taskProp.Value
    $taskBytes = [IO.File]::ReadAllBytes($taskPath)
    $taskMime = switch ([IO.Path]::GetExtension($taskPath).ToLowerInvariant()) {
        '.glb' { 'model/gltf-binary' }
        '.png' { 'image/png' }
        '.svg' { 'image/svg+xml' }
        default { throw 'Unsupported asset extension' }
    }
    $taskRecords[$taskProp.Name] = [ordered]@{mime=$taskMime;base64=[Convert]::ToBase64String($taskBytes);sha256=(Get-FileHash -LiteralPath $taskPath -Algorithm SHA256).Hash.ToLowerInvariant()}
}
foreach ($taskToken in @('<!--OFFLINE_RUNTIME-->', '<!--EMBEDDED_ASSETS-->')) {
    if ([regex]::Matches($taskHtml, [regex]::Escape($taskToken)).Count -ne 1) { throw "Expected exactly one $taskToken" }
}
$taskRuntime = ''
$taskRuntimePath = Join-Path $taskRoot 'vendor/game3d-runtime.iife.js'
if (Test-Path -LiteralPath $taskRuntimePath) {
    $taskRuntime = '<script>' + (Get-Content -LiteralPath $taskRuntimePath -Raw -Encoding UTF8).Replace('</script', '<\/script') + '</script>'
}
$taskJson = ($taskRecords | ConvertTo-Json -Depth 5 -Compress).Replace('</', '<\/')
$taskHtml = $taskHtml.Replace('<!--OFFLINE_RUNTIME-->', $taskRuntime).Replace('<!--EMBEDDED_ASSETS-->', '<script>window.__ASSETS__=' + $taskJson + ';</script>')
$taskLicensePath = Join-Path $taskRoot 'vendor/THREE_LICENSE.txt'
if (Test-Path -LiteralPath $taskLicensePath) {
    $taskLicense = Get-Content -LiteralPath $taskLicensePath -Raw -Encoding UTF8
    $taskHtml += "`n<!-- Three.js 0.185.1 license`n" + $taskLicense.Replace('--', '- -') + "`n-->`n"
}
$taskHtml = $taskHtml.Replace("`r`n", "`n")
[IO.File]::WriteAllText((Join-Path $taskRoot 'index.html'), $taskHtml, [Text.UTF8Encoding]::new($false))
Write-Output ('Built index.html; assets=' + $taskRecords.Count)
