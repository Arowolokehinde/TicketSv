# Counterfoil Website Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the approved Counterfoil interface the actual React website, replacing the prototype redirect.

**Architecture:** Native React pages use pathname routes, shared workspace navigation and the approved visual styles. The archived HTML remains a design reference at its explicit URL, outside the product navigation. Clearly labelled sample tickets remain available; real wallet, storage, SPV and ARC operations await the existing feasibility work.

**Tech Stack:** Existing React, TypeScript, Vite and Playwright. No additional dependencies.

**Spec:** Existing `../specs/2026-10-16-offline-ticket-design.md` and `../design/counterfoil-direction.md`, with the user's correction: this must be the website, not another prototype screen.

## Global Constraints

- Preserve paper `#efecdf`, card `#faf8ed`, ink `#292a22`, oxblood `#722f2e` and acid `#dce68b`.
- Keep the approved landing layout, animations, pause control and explanatory journey.
- Render React components: no iframe, HTML injection, prototype redirect or design-screen navigation.
- `/tickets`, `/venue` and `/scanner` are separate workspaces. Buyer and seller actions belong to the ticket-holder area.
- Retain clearly labelled sample data as previously requested. Never report simulated results as real verification.
- Do not call wallets or remote APIs on startup. Do not expose signing, verification or broadcast actions as working before integration.
- Keep original design files unchanged and the seven feasibility gates untested.
- This correction replaces the scaffold's product-routing deferral. It does not complete the five live blockchain scenes.

## Review Focus

1. Direct URLs, refresh and browser back must render the same native page.
2. Workspace navigation must not mix venue/scanner actions with ticket-holder actions.
3. Sample tickets must never be confused with accepted local packages.
4. Mobile layouts and reduced-motion preferences must work without the prototype's device frame.
5. Visiting product pages must not connect a wallet or call a remote server.

### Task 1: Native landing and routes

**Files:** `src/App.tsx`, `src/ui/LandingPage.tsx`, `src/styles/website.css`, `src/styles/approved.css`, `src/styles/base.css`, `tests/website.browser.test.ts`.

**Interfaces:** `LandingPage(): React.JSX.Element`; pathname routing in App; the root stays `/`.

- [x] Write a failing test for a single landing page inside `#root`, URL `/`, and no design canvas.
- [x] Port the approved landing markup to JSX and interactions to React state. Adapt approved CSS to the browser viewport.
- [x] Add normal links to `/tickets`, `/venue`, `/scanner`; preserve the motion pause and three-stage educational journey.
- [x] Verify native routing, interactions and mobile layout.

### Task 2: Native workspace pages

**Files:** `src/ui/Workspace.tsx`, `src/ui/TicketPages.tsx`, `src/ui/OperationPages.tsx`, `src/ui/samples.ts`, `src/App.tsx`.

**Interfaces:** `Workspace({role, title, children})`; role is `holder | venue | scanner`. Ticket routes: `/tickets`, `/tickets/receive`, `/tickets/transfer`, `/tickets/sample`. Shared preparation/headers/log routes are nested under each workspace to retain role.

- [x] Write failing tests for separate workspaces, route refresh, sample labelling and unavailable blockchain actions.
- [x] Build the collection and sample-detail pages from the approved ticket visual treatment. Retain an explicit empty-collection view.
- [x] Build receive, transfer, venue and scanner entry pages with truthful integration status and disabled dependent actions.
- [x] Build preparation, header and activity pages showing actual uninitialized state, not fabricated successful checks.
- [x] Test all product routes, keyboard navigation, unknown-route recovery, no external requests and responsive overflow.

### Task 3: Documentation and verification

**Files:** `README.md`, `docs/scaffolding.md`, `tests/design-preview.browser.test.ts`, `tests/scaffold.browser.test.ts`, `src/dev/FeasibilityScreen.tsx`.

- [x] Update obsolete redirect assertions and harness links to the website. Keep archived-asset integrity checks.
- [x] Document native routes and the exact remaining integration boundary.
- [x] Run unit tests, TypeScript checking, production build and desktop/phone browser tests. Visually inspect landing and workspace screenshots.
- [x] Request independent review, resolve material findings and report the website URL without presenting the prototype as the application.

Scope decision: the prior approved design and the user's explicit correction supply the visual and routing requirements; no new design approval or execution-method choice is needed. Continue native execution in the existing worktree. Integration into the main checkout remains pending the earlier branch decision.

## Completion evidence

Completed 2026-10-20 in the existing scaffold worktree. All 3 unit tests and 24 desktop/phone browser tests passed, with TypeScript checking and production build. Inspected desktop/phone screenshots of the landing and workspace pages. All nine original design/planning files retain their baseline hashes. Independent review found one important copy issue and two minor navigation/accessibility issues; corrected them and verified the new regression checks. Blockchain operations remain unimplemented and disabled.
