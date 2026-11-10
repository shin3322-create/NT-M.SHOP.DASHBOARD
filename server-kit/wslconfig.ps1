# WSL이 저절로 꺼지지 않게 .wslconfig 설정 (instanceIdleTimeout / vmIdleTimeout = -1)
$p = Join-Path $env:USERPROFILE '.wslconfig'
$lines = @(); if (Test-Path $p) { $lines = Get-Content $p }
$lines = $lines | Where-Object { $_ -notmatch '^\s*(instanceIdleTimeout|vmIdleTimeout)\s*=' }
function Add-Key([string[]]$arr, [string]$section, [string]$kv) {
  $i = [Array]::IndexOf($arr, $section)
  if ($i -lt 0) { return $arr + @('', $section, $kv) }
  $before = if ($i -ge 0) { $arr[0..$i] } else { @() }
  $after = if ($i + 1 -lt $arr.Count) { $arr[($i+1)..($arr.Count-1)] } else { @() }
  return $before + @($kv) + $after
}
$lines = @($lines)
$lines = Add-Key $lines '[general]' 'instanceIdleTimeout=-1'
$lines = Add-Key $lines '[wsl2]' 'vmIdleTimeout=-1'
Set-Content -Path $p -Value $lines -Encoding ASCII
Get-Content $p
