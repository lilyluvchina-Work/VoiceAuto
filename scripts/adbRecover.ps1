param(
  [string]$DeviceId = "",
  [int]$BridgePort = 17321,
  [int]$WaitSeconds = 180,
  [switch]$NoBridgeRestart
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$LogDir = Join-Path $Root "logs"
$LogFile = Join-Path $LogDir "adb-recover.log"

function Write-Step {
  param([string]$Message)
  $line = "[{0}] {1}" -f (Get-Date).ToString("s"), $Message
  Write-Host $line
  Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

function Invoke-Adb {
  param([string[]]$Arguments)
  $output = & adb @Arguments 2>&1
  $exit = $LASTEXITCODE
  return [PSCustomObject]@{
    ExitCode = $exit
    Output = ($output -join [Environment]::NewLine)
  }
}

function Get-AdbDevices {
  $result = Invoke-Adb @("devices", "-l")
  $devices = @()
  foreach ($line in ($result.Output -split "`r?`n")) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("List of devices attached")) {
      continue
    }

    $parts = $trimmed -split "\s+"
    if ($parts.Length -ge 2) {
      $devices += [PSCustomObject]@{
        Id = $parts[0]
        State = $parts[1]
        Raw = $trimmed
      }
    }
  }
  return $devices
}

function Wait-ForDevice {
  param([string]$ExpectedDeviceId, [int]$TimeoutSeconds)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $devices = @(Get-AdbDevices)
    $devices | ForEach-Object { Write-Step ("ADB device: " + $_.Raw) }

    $matched = $null
    if ($ExpectedDeviceId) {
      $matched = $devices | Where-Object { $_.Id -eq $ExpectedDeviceId -and $_.State -eq "device" } | Select-Object -First 1
    } else {
      $matched = $devices | Where-Object { $_.State -eq "device" } | Select-Object -First 1
    }

    if ($matched) {
      return $matched.Id
    }

    Start-Sleep -Seconds 2
  }

  throw "未在 ${TimeoutSeconds}s 内发现可用 ADB device"
}

function Stop-BridgeOnPort {
  param([int]$Port)
  $netstat = netstat -ano | Select-String ":$Port"
  foreach ($line in $netstat) {
    $text = $line.ToString()
    if ($text -notmatch "LISTENING\s+(\d+)$") {
      continue
    }
    $pid = [int]$Matches[1]
    Write-Step "停止旧 ADB Bridge 进程 PID=$pid Port=$Port"
    Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
  }
}

New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
$DisplayDeviceId = if ($DeviceId) { $DeviceId } else { "<default>" }
Write-Step "开始 ADB 恢复，DeviceId=$DisplayDeviceId BridgePort=$BridgePort WaitSeconds=$WaitSeconds"

Write-Step "重启 adb server"
Invoke-Adb @("kill-server") | Out-Null
Start-Sleep -Seconds 1
$startResult = Invoke-Adb @("start-server")
Write-Step $startResult.Output

Write-Step "等待 ADB device 在线"
$resolvedDeviceId = Wait-ForDevice -ExpectedDeviceId $DeviceId -TimeoutSeconds $WaitSeconds
Write-Step "ADB device 已在线: $resolvedDeviceId"

Write-Step "检查 sys.boot_completed"
$deadline = (Get-Date).AddSeconds($WaitSeconds)
do {
  $boot = Invoke-Adb @("-s", $resolvedDeviceId, "shell", "getprop", "sys.boot_completed")
  $bootValue = $boot.Output.Trim()
  Write-Step "sys.boot_completed=$bootValue"
  if ($bootValue -eq "1") {
    break
  }
  Start-Sleep -Seconds 2
} while ((Get-Date) -lt $deadline)

if ($bootValue -ne "1") {
  throw "设备已连接，但 sys.boot_completed 未在 ${WaitSeconds}s 内返回 1"
}

if (-not $NoBridgeRestart) {
  Stop-BridgeOnPort -Port $BridgePort
  Write-Step "启动 ADB Bridge"
  Start-Process -FilePath "node.exe" `
    -ArgumentList @("scripts\adbBridge.cjs") `
    -WorkingDirectory $Root `
    -WindowStyle Hidden
  Start-Sleep -Seconds 1
  Write-Step "ADB Bridge 已启动: http://127.0.0.1:$BridgePort"
}

Write-Step "ADB 恢复完成"
