#requires -Version 7.0
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$publishRoot = Join-Path $projectRoot '.pages-publish'
$publishDirectory = Join-Path $publishRoot ([guid]::NewGuid().ToString('N'))
$originalPrompt = $env:GIT_TERMINAL_PROMPT
$env:GIT_TERMINAL_PROMPT = '0'

function Invoke-Native {
    param([string]$Program, [string[]]$Arguments)
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed (exit $LASTEXITCODE)." }
}

try {
    Push-Location -LiteralPath $projectRoot
    try {
        $remote = & git remote get-url origin
        if ($LASTEXITCODE -ne 0 -or !$remote) { throw 'Configure the GitHub origin remote first.' }
        if ($remote -notmatch '^(https://github\.com/|git@github\.com:)[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(?:\.git)?$') {
            throw 'origin must be a GitHub repository URL without embedded credentials.'
        }
        $commitName = & git config user.name
        $commitEmail = & git config user.email
        if (!$commitName -or !$commitEmail) { throw 'Set Git user.name and user.email before publishing.' }

        Invoke-Native 'node' @('--test')
        Invoke-Native 'node' @('scripts/build-pages.mjs')
        New-Item -ItemType Directory -Path $publishDirectory | Out-Null
        $resolvedPublishRoot = [IO.Path]::GetFullPath($publishRoot) + [IO.Path]::DirectorySeparatorChar
        $resolvedPublishDirectory = (Resolve-Path -LiteralPath $publishDirectory).Path
        if (!$resolvedPublishDirectory.StartsWith($resolvedPublishRoot, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Refusing a deployment path outside the temporary publication directory.'
        }
        Invoke-Native 'git' @('-C', $publishDirectory, 'init', '--initial-branch=gh-pages')
        Invoke-Native 'git' @('-C', $publishDirectory, 'remote', 'add', 'origin', $remote)
        Invoke-Native 'git' @('-C', $publishDirectory, 'config', 'user.name', $commitName)
        Invoke-Native 'git' @('-C', $publishDirectory, 'config', 'user.email', $commitEmail)
        # Reuse the existing GitHub CLI login; no credentials are written to disk.
        Invoke-Native 'git' @('-C', $publishDirectory, 'config', 'credential.helper', '')
        Invoke-Native 'git' @('-C', $publishDirectory, 'config', '--add', 'credential.helper', '!gh auth git-credential')

        & git -C $publishDirectory ls-remote --exit-code --heads origin gh-pages | Out-Null
        $branchResult = $LASTEXITCODE
        if ($branchResult -eq 0) {
            Invoke-Native 'git' @('-C', $publishDirectory, 'fetch', '--depth=1', 'origin', 'gh-pages')
            Invoke-Native 'git' @('-C', $publishDirectory, 'checkout', '-B', 'gh-pages', 'FETCH_HEAD')
            # Only the temporary deployment checkout is replaced. Previous releases remain in Git history.
            Invoke-Native 'git' @('-C', $publishDirectory, 'rm', '-r', '--quiet', '--ignore-unmatch', '--', '.')
        } elseif ($branchResult -ne 2) {
            throw 'Unable to check the remote gh-pages branch.'
        }

        foreach ($item in Get-ChildItem -LiteralPath (Join-Path $projectRoot 'dist') -Force) {
            Copy-Item -LiteralPath $item.FullName -Destination $publishDirectory -Recurse -Force
        }
        Invoke-Native 'git' @('-C', $publishDirectory, 'add', '--all')
        & git -C $publishDirectory diff --cached --quiet
        $diffResult = $LASTEXITCODE
        if ($diffResult -eq 1) {
            Invoke-Native 'git' @('-C', $publishDirectory, 'commit', '--quiet', '-m', 'Publish static site')
            # No force push: concurrent deployments are rejected instead of overwritten.
            Invoke-Native 'git' @('-C', $publishDirectory, 'push', 'origin', 'HEAD:refs/heads/gh-pages')
            Write-Host 'Static files pushed. GitHub Pages will deploy the gh-pages branch.'
        } elseif ($diffResult -eq 0) {
            Write-Host 'The published files already match this build.'
        } else { throw 'Unable to compare deployment files.' }

        $resolvedPublishRoot = [IO.Path]::GetFullPath($publishRoot) + [IO.Path]::DirectorySeparatorChar
        $resolvedPublishDirectory = (Resolve-Path -LiteralPath $publishDirectory).Path
        if (!$resolvedPublishDirectory.StartsWith($resolvedPublishRoot, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Refusing to clean up a path outside the temporary publication directory.'
        }
        Remove-Item -LiteralPath $resolvedPublishDirectory -Recurse -Force
    } finally { Pop-Location }
} catch {
    Write-Warning "Publication stopped. Any temporary checkout is retained at: $publishDirectory"
    throw
} finally {
    $env:GIT_TERMINAL_PROMPT = $originalPrompt
}
