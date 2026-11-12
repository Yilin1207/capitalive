param([ValidateSet('before', 'after')][string]$Phase = 'before')
$ErrorActionPreference = 'Stop'
$link = Get-Content -LiteralPath '.vercel/project.json' -Raw | ConvertFrom-Json
if ($link.projectName -ne 'capitalive' -or $link.projectId -ne 'prj_sdOahRfovMpRQ3Td9uRNh6kCy61i') { throw 'Unexpected Vercel project link' }
$rawProject = & npx.cmd --yes vercel api "/v9/projects/$($link.projectId)?teamId=$($link.orgId)" --raw
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect Vercel project' }
$project = ($rawProject -join "`n") | ConvertFrom-Json
$rawDomains = & npx.cmd --yes vercel api "/v9/projects/$($link.projectId)/domains?teamId=$($link.orgId)" --raw
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect Vercel domains' }
$domains = ($rawDomains -join "`n") | ConvertFrom-Json
# Strict allowlist: never persist provider secrets, encrypted env values or protection bypass tokens.
$settings = [ordered]@{
  id = $project.id; name = $project.name; accountId = $project.accountId
  framework = $project.framework; rootDirectory = $project.rootDirectory
  buildCommand = $project.buildCommand; installCommand = $project.installCommand
  outputDirectory = $project.outputDirectory; nodeVersion = $project.nodeVersion
  serverlessFunctionRegion = $project.serverlessFunctionRegion
  resourceConfig = $project.resourceConfig; ssoProtection = $project.ssoProtection
  env = @($project.env | Sort-Object key | Select-Object id,key,type,target,configurationId,updatedAt)
  domains = @($domains.domains | Sort-Object name | Select-Object name,redirect,redirectStatusCode,gitBranch,verified)
}
$output = 'verification/capitalive-v2-release'
New-Item -ItemType Directory -Path $output -Force | Out-Null
$utf8 = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText((Join-Path (Get-Location) "$output/settings-$Phase.json"), ($settings | ConvertTo-Json -Depth 12), $utf8)
$release = [ordered]@{ checked_at = [DateTime]::UtcNow.ToString('o'); project = $project.name; production_deployment = $project.targets.production.id }
[IO.File]::WriteAllText((Join-Path (Get-Location) "$output/deployment-$Phase.json"), ($release | ConvertTo-Json), $utf8)
Write-Output ($release | ConvertTo-Json -Compress)
if ($Phase -eq 'after') {
  $before = Get-Content -LiteralPath "$output/settings-before.json" -Raw
  $after = Get-Content -LiteralPath "$output/settings-after.json" -Raw
  if ($before -ne $after) { throw 'Project settings differ; inspect sanitized before/after snapshots' }
  Write-Output 'Project settings, domain configuration and environment metadata unchanged.'
}
