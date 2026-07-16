[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$File,

  [Parameter(Position = 1)]
  [string]$Bucket = "openbucket-curl-demo",

  [Parameter(Position = 2)]
  [string]$Key
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if (-not $env:OPENBUCKET_ADMIN_TOKEN) {
  throw "Set OPENBUCKET_ADMIN_TOKEN to the daemon management token."
}

$source = (Resolve-Path -LiteralPath $File).Path
if (-not $Key) { $Key = [IO.Path]::GetFileName($source) }
$api = if ($env:OPENBUCKET_API) { $env:OPENBUCKET_API.TrimEnd("/") } else { "http://127.0.0.1:7272" }
$output = if ($env:OPENBUCKET_DOWNLOAD_PATH) {
  $env:OPENBUCKET_DOWNLOAD_PATH
} else {
  Join-Path $PWD "openbucket-curl-download-$([IO.Path]::GetFileName($source))"
}
$headers = @{ Authorization = "Bearer $env:OPENBUCKET_ADMIN_TOKEN" }
$bucketPath = [Uri]::EscapeDataString($Bucket)
$keyPath = (($Key -split "/") | ForEach-Object { [Uri]::EscapeDataString($_) }) -join "/"

$buckets = Invoke-RestMethod -Uri "$api/v1/buckets" -Headers $headers
if (-not ($buckets.buckets | Where-Object { $_.name -eq $Bucket })) {
  Invoke-RestMethod `
    -Method Post `
    -Uri "$api/v1/buckets" `
    -Headers $headers `
    -ContentType "application/json" `
    -Body (@{ name = $Bucket; public = $false } | ConvertTo-Json)
}

Invoke-RestMethod `
  -Method Put `
  -Uri "$api/v1/buckets/$bucketPath/objects/$keyPath" `
  -Headers $headers `
  -ContentType "application/octet-stream" `
  -InFile $source

Invoke-RestMethod -Uri "$api/v1/buckets/$bucketPath/objects" -Headers $headers
Invoke-WebRequest `
  -Uri "$api/v1/buckets/$bucketPath/objects/$keyPath" `
  -Headers $headers `
  -OutFile $output

$share = Invoke-RestMethod `
  -Method Post `
  -Uri "$api/v1/buckets/$bucketPath/share" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body (@{ key = $Key; expiresIn = 300 } | ConvertTo-Json)
$share | Select-Object url, expiresAt

Invoke-RestMethod -Uri "$api/v1/analytics" -Headers $headers |
  Select-Object requests, requestsToday, totalBytesIn, totalBytesOut, averageLatencyMs, errors

Write-Host "Downloaded object to $output"
Write-Host "The bucket and object were intentionally left in place."
