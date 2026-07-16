# Project Overview: Hydrogen Storefront

Welcome to the Hydrogen Storefront project. This repository contains a headless Shopify storefront built with the modern Shopify technology stack. It is designed for high performance, developer productivity, and seamless integration with the Shopify ecosystem.

## Project Goal

The primary objective of this project is to provide a fast, customizable, and scalable headless commerce experience using **Shopify Hydrogen** and **Remix**. The storefront is optimized for deployment on **Shopify Oxygen**, Shopify's global edge hosting platform.

## Core Technology Stack

- **Framework:** [Hydrogen (v2025.1.1)](https://hydrogen.shopify.dev/) - Shopify’s stack for headless commerce.
- **Runtime:** [Remix Oxygen](https://remix.run/) - A full-stack web framework focused on the user interface and resilient user experience.
- **Styling:** [Tailwind CSS](https://tailwindcss.com/) - A utility-first CSS framework for rapid UI development.
- **Components:** [Headless UI](https://headlessui.com/) - Completely unstyled, fully accessible UI components.
- **API:** [Shopify Storefront API](https://shopify.dev/docs/api/storefront) - GraphQL-based API for fetching shop data.
- **Tooling:** [Shopify CLI](https://shopify.dev/docs/apps/tools/cli) - Command-line tools for Hydrogen development.

## Documentation Index

This repository includes detailed documentation for various aspects of the application:

| Document                                                      | Description                                                                        |
| :------------------------------------------------------------ | :--------------------------------------------------------------------------------- |
| [Data Layer Architecture](./ARCHITECTURE-DATA-LAYER.md)       | Details on Storefront API integration, GraphQL queries, and TypeScript interfaces. |
| [UI Component Structure](./UI-COMPONENT-STRUCTURE.md)         | Overview of component hierarchy, state management, and Tailwind conventions.       |
| [Infrastructure & Deployment](./INFRASTRUCTURE-DEPLOYMENT.md) | Information on environment variables, Oxygen hosting, and CI/CD pipelines.         |

## Local Development Workflow

### 1. Prerequisites

Ensure you have the following installed:

- **Node.js:** version 20.0.0 or higher.
- **npm:** usually bundled with Node.js.
- **Shopify CLI:** installed globally or accessible via `npm`.

### 2. Initial Setup

Clone the repository and install dependencies:

```bash
npm install
```

### 3. Environment Configuration

Create a `.env` file in the root directory and populate it with your shop's credentials. Refer to [Infrastructure & Deployment](./INFRASTRUCTURE-DEPLOYMENT.md) for the required variables.

### 4. Running the Development Server

Start the local development server with HMR (Hot Module Replacement) and GraphQL code generation:

```bash
npm run dev
```

This command runs `shopify hydrogen dev --codegen`.

### 5. Common Commands

- `npm run build`: Build the project for production.
- `npm run preview`: Build and preview the production build locally.
- `npm run lint`: Run ESLint to check for code style issues.
- `npm run format`: Format the codebase using Prettier.
- `npm run e2e`: Run end-to-end tests using Playwright.

## Architecture Highlights

- **Server-Side Rendering:** All routes leverage Remix loaders for efficient data fetching on the server.
- **Type Safety:** Strict TypeScript interfaces are used for all Storefront API responses.
- **URL-Driven State:** Product variant selection and other UI states are synchronized with the URL to ensure deep-linking and a consistent user experience.
- **Edge Deployment:** The application is built to run on Oxygen, ensuring low-latency delivery to users worldwide.

---

For more specific technical details, please refer to the individual documents in the `/docs` directory.
