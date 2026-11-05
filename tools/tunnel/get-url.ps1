# Read the public hostname from cloudflared's local metrics endpoint.
# Used by start-tunnel.cmd -- parsing this is far more stable than reading
# the human-readable log line, whose layout changes between cloudflared versions.
#
# NOTE: must stay ASCII-only + CRLF. Chinese chars here can get mangled when
# cmd passes arguments through, and this file must never be executed on a
# different codepage.
param(
    [string]$MetricsHost = '127.0.0.1',
    [int]$MetricsPort = 20298,
    [int]$Retries = 45,
    [int]$WaitSeconds = 2
)

$ProgressPreference = 'SilentlyContinue'

for ($i = 0; $i -lt $Retries; $i++) {
    try {
        $content = (Invoke-WebRequest `
            -Uri "http://${MetricsHost}:${MetricsPort}/metrics" `
            -UseBasicParsing -TimeoutSec 3).Content

        if ($content -match 'https://[a-z0-9\-]+\.trycloudflare\.com') {
            Write-Output $matches[0]
            exit 0
        }
    } catch {
        # metrics endpoint not up yet -- keep waiting
    }
    Start-Sleep -Seconds $WaitSeconds
}

exit 1
