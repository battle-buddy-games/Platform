# GitHub Pages Deployment Folder

This folder contains static and dynamically generated content that will be deployed to the `battle-buddy-games/Web-Test` repository for GitHub Pages hosting.

## Purpose

- **Static Content**: HTML, CSS, JavaScript, images, and other static assets
- **Dynamic Content**: Content that may be generated or processed before deployment

## Configuration

### `config.json`

All URLs and configuration values are stored in `config.json` for easy management:

```json
{
  "github": {
    "clientId": "Your GitHub OAuth App Client ID",
    "redirectUri": "https://battle-buddy-games.github.io/Web-Test/gateway.html",
    "scope": "user:email"
  },
  "backend": {
    "apiUrl": "https://your-api-url.com",
    "callbackEndpoint": "/Authentication/github/callback"
  },
  "auth": {
    "google": "https://your-api-url.com/Authentication/Google",
    "discord": "https://your-api-url.com/Authentication/Discord",
    "steam": "https://your-api-url.com/Authentication/SteamWeb"
  },
  "cloudflareTunnels": [
    {
      "name": "cloud",
      "address": "https://example-cloud.tunnel.cloudflare.com"
    },
    {
      "name": "staging",
      "address": "https://example-staging.tunnel.cloudflare.com"
    }
  ]
}
```

### Cloudflare Tunnels

The `cloudflareTunnels` array contains named Cloudflare tunnel configurations. Each tunnel has:
- **name**: A descriptive name for the tunnel (e.g., "cloud", "staging", "development")
- **address**: The full URL of the Cloudflare tunnel endpoint

**To update URLs**: Simply edit `config.json` and the changes will be reflected after deployment.

## Deployment Process

The deployment is automated via the `github-pages-deployment.yml` GitHub Actions workflow, which:

1. Monitors this folder for changes
2. Clones the target repository (`battle-buddy-games/Web-Test`)
3. Replaces all content in the target repository root (except the `.github` folder)
4. Commits and pushes changes to trigger GitHub Pages deployment

## Usage

1. Add your static files to this folder
2. Update `config.json` with your configuration values
3. Commit and push changes to this repository
4. The workflow will automatically deploy to the target repository

## Manual Trigger

You can also manually trigger the deployment workflow from the GitHub Actions tab.

## Important Notes

- The `.github` folder in the target repository is preserved and will not be overwritten
- All other content in the target repository root will be replaced with contents from this folder
- The deployment uses the `PAT_GITHUB` secret configured in this repository
- If `config.json` fails to load, the page will use fallback values and show an error modal

