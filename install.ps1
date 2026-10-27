$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
Add-Type -Namespace TripleA -Name Window -MemberDefinition @"
  [DllImport("kernel32.dll")] public static extern System.IntPtr GetConsoleWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr hWnd, int nCmdShow);
"@
function Hide-Console {
  try {
    $hwnd = [TripleA.Window]::GetConsoleWindow()
    if ($hwnd -ne [IntPtr]::Zero) { [void][TripleA.Window]::ShowWindow($hwnd, 0) }
  } catch { }
}
Hide-Console
$trialMarker = Join-Path $env:APPDATA "TripleAIPTV\install.json"
if (Test-Path $trialMarker) {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show("TripleA was already installed on this computer. The trial cannot be installed again.", "TripleA IPTV Player") | Out-Null
  exit 1
}
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
$log = Join-Path $root "install.log"
function Write-Log($message) {
  Add-Content -Path $log -Value "$(Get-Date -Format s) $message"
}

Add-Type -AssemblyName System.Windows.Forms
$form = New-Object System.Windows.Forms.Form
$form.Text = "TripleA IPTV Player"
$form.Width = 520
$form.Height = 210
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.TopMost = $true
$label = New-Object System.Windows.Forms.Label
$label.Left = 24
$label.Top = 24
$label.Width = 460
$label.Height = 40
$label.Text = "Installing TripleA. Please wait."
$form.Controls.Add($label)
$detail = New-Object System.Windows.Forms.Label
$detail.Left = 24
$detail.Top = 68
$detail.Width = 460
$detail.Height = 36
$detail.Text = "Starting..."
$form.Controls.Add($detail)
$bar = New-Object System.Windows.Forms.ProgressBar
$bar.Left = 24
$bar.Top = 112
$bar.Width = 460
$bar.Height = 22
$bar.Style = "Marquee"
$bar.MarqueeAnimationSpeed = 30
$form.Controls.Add($bar)
$form.Show()
$form.Activate()
Hide-Console
[System.Windows.Forms.Application]::DoEvents()
function Say($message) {
  Write-Log $message
  $label.Text = $message
  $form.Refresh()
  [System.Windows.Forms.Application]::DoEvents()
}
function Note($message) {
  if (-not $message) { return }
  $text = "$message"
  if ($text.Length -gt 90) { $text = $text.Substring(0, 90) }
  $detail.Text = $text
  [System.Windows.Forms.Application]::DoEvents()
}
function Run-Step($file, $arguments) {
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = $file
  $info.Arguments = $arguments
  $info.WorkingDirectory = $root
  $info.UseShellExecute = $false
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $info.CreateNoWindow = $true
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $info
  $script:stepLine = ""
  $onLine = {
    if ($EventArgs.Data) {
      $script:stepLine = $EventArgs.Data
    }
  }
  $process.add_OutputDataReceived($onLine)
  $process.add_ErrorDataReceived($onLine)
  [void]$process.Start()
  $process.BeginOutputReadLine()
  $process.BeginErrorReadLine()
  while (-not $process.HasExited) {
    if ($script:stepLine) { Note $script:stepLine }
    [System.Windows.Forms.Application]::DoEvents()
    Start-Sleep -Milliseconds 150
  }
  $process.WaitForExit()
  return $process.ExitCode
}

try {
  $nodeHome = Join-Path $root "vendor\node\win"
  if (-not (Test-Path (Join-Path $nodeHome "node.exe"))) {
    $arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
    Say "Downloading Node.js..."
    $vendor = Join-Path $root "vendor\node"
    New-Item -ItemType Directory -Force -Path $vendor | Out-Null
    $zip = Join-Path $vendor "node.zip"
    $bundled = Join-Path $root "vendor\node\node-win.zip"
    if (Test-Path $bundled) {
      Copy-Item $bundled $zip -Force
    } else {
      $bar.Style = "Continuous"
      $bar.Value = 0
      [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
      $downloaded = $false
      for ($try = 1; $try -le 3 -and -not $downloaded; $try++) {
        try {
          $client = New-Object System.Net.WebClient
          $client.Headers["User-Agent"] = "TripleA"
          $script:downloadPct = 0
          $client.add_DownloadProgressChanged({
            $script:downloadPct = $_.ProgressPercentage
          })
          $client.DownloadFileAsync("https://nodejs.org/dist/v24.22.0/node-v24.22.0-win-$arch.zip", $zip)
          while ($client.IsBusy) {
            $pct = [int]$script:downloadPct
            if ($pct -ge 0 -and $pct -le 100) { $bar.Value = $pct }
            Note "Downloading Node.js... $pct%"
            [System.Windows.Forms.Application]::DoEvents()
            Start-Sleep -Milliseconds 100
          }
          $client.Dispose()
          if ((Test-Path $zip) -and ((Get-Item $zip).Length -gt 1000000)) { $downloaded = $true }
        } catch {
          Write-Log $_
          Note "Retrying Node.js download..."
          Start-Sleep -Seconds 2
        }
      }
      if (-not $downloaded) { throw "Could not download Node.js. Check the internet connection and try again." }
    }
    $bar.Style = "Marquee"
    Say "Unpacking Node.js..."
    $tmp = Join-Path $vendor "tmp"
    if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
    Expand-Archive -Path $zip -DestinationPath $tmp -Force
    $unpacked = Get-ChildItem $tmp -Directory | Select-Object -First 1
    if (Test-Path $nodeHome) { Remove-Item $nodeHome -Recurse -Force }
    Move-Item $unpacked.FullName $nodeHome
  }
  $env:Path = "$nodeHome;$env:Path"
  $electron = Join-Path $root "vendor\electron\electron.exe"
  if (-not (Test-Path $electron)) {
    Say "Unpacking the player..."
    $bundledElectron = Join-Path $root "vendor\electron-win\electron-win.zip"
    if (-not (Test-Path $bundledElectron)) { throw "The player files are missing. Download TripleA Setup again." }
    $tmp = Join-Path $root "vendor\electron-tmp"
    if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
    Expand-Archive -Path $bundledElectron -DestinationPath $tmp -Force
    $dest = Join-Path $root "vendor\electron"
    if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
    Move-Item $tmp $dest
    if (-not (Test-Path $electron)) { throw "The player did not unpack." }
  }
  Say "Opening TripleA..."
  Hide-Console
  $shell = New-Object -ComObject WScript.Shell
  $desktop = [Environment]::GetFolderPath("Desktop")
  $programs = [Environment]::GetFolderPath("Programs")
  $icon = Join-Path $root "public\logo.ico"
  $player = Join-Path $root "windows\player.cjs"
  foreach ($link in @((Join-Path $desktop "TripleA IPTV Player.lnk"), (Join-Path $programs "TripleA IPTV Player.lnk"))) {
    try {
      $shortcut = $shell.CreateShortcut($link)
      $shortcut.TargetPath = $electron
      $shortcut.Arguments = "`"$player`""
      $shortcut.WorkingDirectory = $root
      $shortcut.WindowStyle = 1
      $shortcut.Description = "TripleA IPTV Player"
      if (Test-Path $icon) { $shortcut.IconLocation = $icon }
      $shortcut.Save()
    } catch { }
  }
  Start-Process -FilePath $electron -ArgumentList "`"$player`"" -WorkingDirectory $root
  Hide-Console
  $form.Close()
  exit 0
} catch {
  Write-Log $_
  $form.Close()
  [System.Windows.Forms.MessageBox]::Show(
    "TripleA did not install.`n`n$($_.Exception.Message)`n`nDetails are in install.log in this folder.",
    "TripleA IPTV Player"
  ) | Out-Null
  exit 1
}
