# Hydrogen Storefront: Demo Store

This repository is a headless Shopify storefront built with Hydrogen and Remix. It serves as a **multi-agent AI-driven learning project**, where documentation and architectural patterns are co-authored by AI agents to demonstrate best practices in modern Shopify development.

## Project Structure & Documentation

Detailed technical documentation is located in the `docs/` directory. It is highly recommended to start with the Project Overview:

- **[Project Overview](./docs/PROJECT-OVERVIEW.md)**: The high-level project charter and onboarding guide.
- **[Data Layer Architecture](./docs/ARCHITECTURE-DATA-LAYER.md)**: Patterns for Storefront API integration and GraphQL queries.
- **[UI Component Structure](./docs/UI-COMPONENT-STRUCTURE.md)**: Deep dive into the frontend hierarchy and state management.
- **[Infrastructure & Deployment](./docs/INFRASTRUCTURE-DEPLOYMENT.md)**: Details on Oxygen hosting, environment variables, and CI/CD.

---

## What's Included

- [Remix](https://remix.run/)
- [Hydrogen](https://hydrogen.shopify.dev/)
- [Oxygen](https://shopify.dev/docs/custom-storefronts/hydrogen/deployment/oxygen)
- Shopify CLI
- ESLint & Prettier
- GraphQL generator
- TypeScript and JavaScript flavors
- Tailwind CSS (via PostCSS)
- Full-featured setup of components and routes

## Getting Started

**Requirements:**

- Node.js version 20.0.0 or higher

### Installation

```bash
npm install
```

Remember to update `.env` with your shop's domain and Storefront API token! Refer to [Infrastructure & Deployment](./docs/INFRASTRUCTURE-DEPLOYMENT.md) for the required environment variables.

## Local Development

```bash
npm run dev
```

## Building for Production

```bash
npm run build
```

To preview the production build locally:

```bash
npm run preview
```

## Setup for using Customer Account API (`/account` section)

### Setup public domain using ngrok

1. Setup a [ngrok](https://ngrok.com/) account and add a permanent domain (ie. `https://<your-ngrok-domain>.app`).
1. Install the [ngrok CLI](https://ngrok.com/download) to use in terminal
1. Start ngrok using `ngrok http --domain=<your-ngrok-domain>.app 3000`

### Include public domain in Customer Account API settings

1. Go to your Shopify admin => `Hydrogen` or `Headless` app/channel => Customer Account API => Application setup
1. Edit `Callback URI(s)` to include `https://<your-ngrok-domain>.app/account/authorize`
1. Edit `Javascript origin(s)` to include your public domain `https://<your-ngrok-domain>.app` or keep it blank
1. Edit `Logout URI` to include your public domain `https://<your-ngrok-domain>.app` or keep it blank

---

[Check out Hydrogen docs](https://shopify.dev/custom-storefronts/hydrogen)
[Get familiar with Remix](https://remix.run/docs/en/main)
