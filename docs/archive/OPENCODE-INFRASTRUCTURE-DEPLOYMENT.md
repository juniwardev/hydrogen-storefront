# Infrastructure & Deployment

This document serves as the persistent record for the Hydrogen storefront's infrastructure, local development configuration, and CI/CD pipelines.

## Baseline Infrastructure Setup

The storefront is built using **Shopify Hydrogen**, a React-based framework for building custom storefronts on Shopify. It leverages **Remix** for server-side rendering (SSR) and data loading, and is bundled using **Vite**.

- **Framework**: Hydrogen (v2025.1.1)
- **Runtime**: Remix Oxygen (Shopify's edge worker runtime)
- **Bundler**: Vite
- **Hosting**: Shopify Oxygen

## Shopify CLI `.hydrogen/` Directory

The `.hydrogen/` directory is managed by the Shopify CLI. Its primary purpose is to store **Hydrogen upgrade logs and migration guides**.

When the project is updated using `shopify hydrogen upgrade`, the CLI generates markdown files in this directory (e.g., `upgrade-2024.10.1-to-2025.1.0.md`). These files detail:

- Breaking changes between versions.
- Required code modifications.
- New features and best practices introduced in the latest version.

These artifacts should be committed to version control to provide a history of the project's framework migrations.

## Required Environment Variables (Local Development)

To connect the storefront to the Shopify Storefront API and handle sessions locally, the following environment variables are required in a `.env` file:

| Variable                                | Purpose                                          |
| :-------------------------------------- | :----------------------------------------------- |
| `SESSION_SECRET`                        | Used for encrypting session cookies.             |
| `PUBLIC_STOREFRONT_API_TOKEN`           | Public access token for the Storefront API.      |
| `PUBLIC_STORE_DOMAIN`                   | The `myshopify.com` domain of the Shopify store. |
| `PUBLIC_CUSTOMER_ACCOUNT_API_CLIENT_ID` | Client ID for the Customer Account API.          |
| `PUBLIC_CHECKOUT_DOMAIN`                | The domain used for the checkout process.        |
| `SHOP_ID`                               | The unique identifier for the Shopify shop.      |

## CI/CD Workflow: Shopify Oxygen

Deployment to Shopify Oxygen is automated via GitHub Actions.

### 1. Continuous Integration (`ci.yml`)

Runs on every pull request to ensure code quality:

- **Linting**: ESLint checks for code style and potential errors.
- **Formatting**: Prettier ensures consistent code formatting.
- **Typechecking**: TypeScript validation.
- **Build**: Verifies the project can be successfully bundled for production.
- **End-to-End Tests**: Runs Playwright tests to verify core functionality.

### 2. Oxygen Deployment (`oxygen-deployment-*.yml`)

Runs on every push to tracked branches (e.g., `main` or specific environment branches):

- **Build & Publish**: Uses `shopify hydrogen deploy` to build the worker and upload assets to Oxygen.
- **E2E Post-Deployment**: Executes end-to-end tests against the generated preview/production URL to verify the deployment's health.
- **Deployment Tracking**: Updates GitHub Deployment status and provides preview URLs in pull requests.

Deployment secrets (like `OXYGEN_DEPLOYMENT_TOKEN_*`) are managed in GitHub Repository Secrets.
