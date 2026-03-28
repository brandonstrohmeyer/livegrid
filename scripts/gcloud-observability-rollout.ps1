param(
  [string]$ProjectId = "livegrid-c33c6",
  [string]$Region = "us-central1",
  [string]$Host = "livegrid.stro.io",
  [string]$DashboardId = "projects/livegrid-c33c6/dashboards/f41fa337-eb78-478c-b879-f4376a84fd9c",
  [switch]$UseLocalConfig
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$templatePath = Join-Path $repoRoot "docs\observability-dashboard.json"
$renderedDashboardPath = Join-Path $repoRoot "dist\observability-dashboard.rendered.json"

New-Item -ItemType Directory -Force -Path (Split-Path $renderedDashboardPath -Parent) | Out-Null
if ($UseLocalConfig) {
  $cloudSdkConfig = Join-Path $repoRoot ".gcloud-config"
  New-Item -ItemType Directory -Force -Path $cloudSdkConfig | Out-Null
  $env:CLOUDSDK_CONFIG = $cloudSdkConfig
}

function Invoke-GCloudJson {
  param(
    [string[]]$Args,
    [switch]$AllowFailure
  )

  $output = & gcloud.cmd @Args 2>&1
  if ($LASTEXITCODE -ne 0) {
    if ($AllowFailure) {
      return $null
    }
    throw "gcloud failed: $($Args -join ' ')`n$output"
  }

  if (-not $output) {
    return $null
  }

  return ($output | Out-String | ConvertFrom-Json)
}

function Invoke-GCloud {
  param([string[]]$Args)

  & gcloud.cmd @Args
  if ($LASTEXITCODE -ne 0) {
    throw "gcloud failed: $($Args -join ' ')"
  }
}

function Upsert-LogMetric {
  param(
    [string]$Name,
    [string]$Description,
    [string]$Filter
  )

  $metric = Invoke-GCloudJson -Args @("logging", "metrics", "describe", $Name, "--project=$ProjectId", "--format=json") -AllowFailure
  if ($metric) {
    Invoke-GCloud -Args @(
      "logging", "metrics", "update", $Name,
      "--project=$ProjectId",
      "--description=$Description",
      "--log-filter=$Filter"
    )
    return
  }

  Invoke-GCloud -Args @(
    "logging", "metrics", "create", $Name,
    "--project=$ProjectId",
    "--description=$Description",
    "--log-filter=$Filter"
  )
}

function Upsert-UptimeCheck {
  param(
    [string]$DisplayName,
    [string]$Path
  )

  $existing = Invoke-GCloudJson -Args @(
    "monitoring", "uptime", "list-configs",
    "--project=$ProjectId",
    "--format=json"
  )

  $match = $existing | Where-Object { $_.displayName -eq $DisplayName } | Select-Object -First 1
  if ($match) {
    Invoke-GCloud -Args @(
      "monitoring", "uptime", "update", $match.name,
      "--project=$ProjectId",
      "--display-name=$DisplayName",
      "--path=$Path",
      "--timeout=10",
      "--period=1",
      "--validate-ssl",
      "--set-regions=usa-iowa,usa-oregon,usa-virginia",
      "--set-status-classes=2xx",
      "--matcher-content=`"status`": `"ok`"",
      "--matcher-type=contains-string"
    )
    return $match.name
  }

  $created = Invoke-GCloudJson -Args @(
    "monitoring", "uptime", "create", $DisplayName,
    "--project=$ProjectId",
    "--resource-type=uptime-url",
    "--resource-labels=host=$Host,project_id=$ProjectId",
    "--protocol=https",
    "--path=$Path",
    "--timeout=10",
    "--period=1",
    "--validate-ssl",
    "--regions=usa-iowa,usa-oregon,usa-virginia",
    "--status-classes=2xx",
    "--matcher-content=`"status`": `"ok`"",
    "--matcher-type=contains-string",
    "--format=json"
  )

  return $created.name
}

function Render-Dashboard {
  param(
    [string]$HostingCheckId,
    [string]$ApiCheckId,
    [string]$Etag
  )

  $rawTemplate = Get-Content $templatePath -Raw
  $rendered = $rawTemplate.Replace('${hosting_health_check_id}', ($HostingCheckId -replace '^projects/[^/]+/uptimeCheckConfigs/', ''))
  $rendered = $rendered.Replace('${api_health_check_id}', ($ApiCheckId -replace '^projects/[^/]+/uptimeCheckConfigs/', ''))
  $dashboard = $rendered | ConvertFrom-Json
  if ($Etag) {
    $dashboard | Add-Member -NotePropertyName etag -NotePropertyValue $Etag -Force
  }
  $dashboard | ConvertTo-Json -Depth 100 | Set-Content -Path $renderedDashboardPath
}

$logMetrics = @(
  @{
    Name = "livegrid_client_errors"
    Description = "Count of client-side error telemetry events."
    Filter = "resource.type=`"cloud_run_revision`" AND resource.labels.location=`"$Region`" AND jsonPayload.event=`"client.error`""
  },
  @{
    Name = "livegrid_client_health_failures"
    Description = "Count of client-side health failures such as missing Firebase config."
    Filter = "resource.type=`"cloud_run_revision`" AND resource.labels.location=`"$Region`" AND jsonPayload.event=`"client.health_failed`""
  },
  @{
    Name = "livegrid_backend_health_failures"
    Description = "Count of backend health check failures or degraded states."
    Filter = "resource.type=`"cloud_run_revision`" AND resource.labels.location=`"$Region`" AND jsonPayload.event=`"system.health_failed`""
  },
  @{
    Name = "livegrid_client_telemetry_rejected"
    Description = "Count of rejected or rate-limited client telemetry requests."
    Filter = "resource.type=`"cloud_run_revision`" AND resource.labels.location=`"$Region`" AND jsonPayload.event=`"client.telemetry_rejected`""
  },
  @{
    Name = "livegrid_visitor_opened"
    Description = "Count of visitor session-open telemetry events."
    Filter = "resource.type=`"cloud_run_revision`" AND resource.labels.location=`"$Region`" AND jsonPayload.event=`"visitor.opened`""
  },
  @{
    Name = "livegrid_visitor_event_selected"
    Description = "Count of visitor event-selection telemetry events."
    Filter = "resource.type=`"cloud_run_revision`" AND resource.labels.location=`"$Region`" AND jsonPayload.event=`"visitor.event_selected`""
  }
)

foreach ($metric in $logMetrics) {
  Upsert-LogMetric -Name $metric.Name -Description $metric.Description -Filter $metric.Filter
}

$hostingCheckName = Upsert-UptimeCheck -DisplayName "LiveGrid Hosting Healthz" -Path "/healthz.json"
$apiCheckName = Upsert-UptimeCheck -DisplayName "LiveGrid API Health" -Path "/api/health"

$dashboard = Invoke-GCloudJson -Args @(
  "monitoring", "dashboards", "describe", $DashboardId,
  "--project=$ProjectId",
  "--format=json"
) -AllowFailure

Render-Dashboard -HostingCheckId $hostingCheckName -ApiCheckId $apiCheckName -Etag $dashboard.etag

if ($dashboard) {
  Invoke-GCloud -Args @(
    "monitoring", "dashboards", "update", $DashboardId,
    "--project=$ProjectId",
    "--config-from-file=$renderedDashboardPath"
  )
} else {
  Invoke-GCloud -Args @(
    "monitoring", "dashboards", "create",
    "--project=$ProjectId",
    "--config-from-file=$renderedDashboardPath"
  )
}

Write-Host "Observability rollout complete."
Write-Host "Hosting uptime check: $hostingCheckName"
Write-Host "API uptime check: $apiCheckName"
Write-Host "Rendered dashboard: $renderedDashboardPath"
