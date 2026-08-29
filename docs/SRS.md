# Software Requirements Specification (SRS)
## VoltGrid — Electricity Management System (EMS)

| | |
|---|---|
| **Document title** | Software Requirements Specification — VoltGrid Electricity Management System |
| **Project** | VoltGrid EMS (repository `RahulMondal03/EMS`) |
| **Version** | 1.0 |
| **Date** | 2026-08-29 |
| **Status** | Draft |
| **Standard** | Prepared following the structure of IEEE Std 830-1998 |

---

## Table of Contents

1. [Introduction](#1-introduction)
   1. [Purpose](#11-purpose)
   2. [Scope](#12-scope)
   3. [Definitions, Acronyms and Abbreviations](#13-definitions-acronyms-and-abbreviations)
   4. [References](#14-references)
   5. [Overview](#15-overview)
2. [Overall Description](#2-overall-description)
   1. [Product Perspective](#21-product-perspective)
   2. [Product Functions](#22-product-functions)
   3. [User Classes and Characteristics](#23-user-classes-and-characteristics)
   4. [Operating Environment](#24-operating-environment)
   5. [Design and Implementation Constraints](#25-design-and-implementation-constraints)
   6. [Assumptions and Dependencies](#26-assumptions-and-dependencies)
3. [Specific Requirements](#3-specific-requirements)
   1. [Functional Requirements](#31-functional-requirements)
   2. [External Interface Requirements](#32-external-interface-requirements)
   3. [Non-Functional Requirements](#33-non-functional-requirements)
4. [Appendices](#4-appendices)
   1. [Appendix A — Data Model Overview](#appendix-a--data-model-overview)
   2. [Appendix B — Glossary](#appendix-b--glossary)

---

## 1. Introduction

### 1.1 Purpose

This Software Requirements Specification (SRS) describes the requirements of **VoltGrid**, a demonstration Electricity Management System (EMS). The document defines the functional and non-functional behaviour of the system as it is actually implemented in the codebase, so that developers, reviewers, evaluators and future maintainers share one authoritative reference.

The system models the end-to-end operational loop of an electricity utility account portal: reading a customer's metered consumption, generating a bill from tiered tariffs, collecting payment, and tracking service complaints from registration to resolution. It is a self-contained front-end application intended primarily as an educational/portfolio demonstration.

### 1.2 Scope

VoltGrid is a **front-end-only web application** built with plain HTML, CSS and JavaScript. It has no server component and no external database; all application data lives in the browser's `localStorage`, and the signed-in user's session lives in `sessionStorage`. The application ships with seed data and can be reset to that seed at any time.

**In scope** (implemented in the codebase):

- Two account types — **Customer** and **Employee** — each with its own portal and sign-in.
- A position-based authorization model for staff (**Grid Manager**, **Supervisor**, **Field Agent**), where navigation, page guards and controls follow the signed-in employee's position.
- Customer self-service: account registration, login, dashboard, viewing and paying bills (Card or UPI), raising complaints, and tracking each complaint's timeline.
- Staff operations: a personal complaint queue, customer lookup, updating complaint status.
- Administrative operations (available to staff whose position grants them): system overview dashboard, complaint assignment/routing, bill generation, customer directory management, tariff/policy management, and staff (team) management.
- A tariff-driven billing engine with tiered slab rates, a green rooftop rate and a fixed service charge.
- Client-side form validation for all data-entry forms.

**Out of scope** (not implemented, and deliberately so for a demo):

- Real server-side persistence, multi-device data sharing, or a real database.
- Real payment processing, real bank/UPI integration, or settlement.
- Cryptographic password hashing, encrypted storage, or transport security beyond what the host page provides.
- Real smart-meter telemetry (the landing page meter animation is illustrative only).
- Email/SMS notifications and password-recovery flows.

### 1.3 Definitions, Acronyms and Abbreviations

| Term | Meaning |
|------|---------|
| **EMS** | Electricity Management System — the product described here (branded "VoltGrid"). |
| **SRS** | Software Requirements Specification. |
| **Customer** | An end user who holds an electricity connection/account. |
| **Employee / Staff** | A utility staff user. Every employee holds one **position**. |
| **Position** | A tiered staff role (Grid Manager, Supervisor, Field Agent) that determines capabilities. |
| **Tier** | The numeric rank of a position (3 = Grid Manager, 2 = Supervisor, 1 = Field Agent). Complaints may only be routed to strictly lower tiers. |
| **Capability / Permission** | A named right (e.g. `billing`, `policies`, `assign`) granted by a position, keyed to nav links, page guards and buttons. |
| **Tariff / Policy** | A named per-unit rate used to price energy consumption. |
| **Slab** | A tier of consumption priced at its own rate (Slab A for the first 200 units, Slab B beyond). |
| **Bill** | A monthly charge for a customer's metered consumption, in state Paid or Unpaid. |
| **Complaint** | A customer-reported service issue tracked through a lifecycle. |
| **Payment** | A recorded transaction (Card or UPI) that settles a bill. |
| **Meter number** | A unique identifier of a customer's metering point (e.g. `MTR-58291`). |
| **UPI** | Unified Payments Interface — an Indian real-time payment method (`name@bank`). |
| **kWh / units** | Kilowatt-hours; the unit of metered energy consumption. |
| **localStorage / sessionStorage** | Browser Web Storage APIs used respectively for durable data and the current session. |
| **IIFE** | Immediately Invoked Function Expression — the JavaScript module pattern used by the app's shared modules. |

### 1.4 References

1. IEEE Std 830-1998 — IEEE Recommended Practice for Software Requirements Specifications.
2. Project `README.md` (VoltGrid — Electricity Management System, demo).
3. Application source code, notably:
   - `js/data.js` — the shared data store, authorization model and billing engine.
   - `js/chrome.js` — position-driven navigation and shared page furniture.
   - `js/validation.js` — the reusable form-validation helper.
   - The per-page HTML files and their matching per-page scripts under `customer/`, `employee/`, `admin/` and `js/`.
4. MDN Web Docs — Web Storage API (`localStorage`, `sessionStorage`).

### 1.5 Overview

The remainder of this document is organized per IEEE 830. **Section 2** gives a high-level description of the product, its users and its environment. **Section 3** specifies detailed functional requirements grouped by module, external interface requirements, and non-functional requirements, each with a unique identifier. **Section 4** provides the data model overview and a glossary.

---

## 2. Overall Description

### 2.1 Product Perspective

VoltGrid is a **self-contained, client-side single-application** with no back end. It is organized as a set of static pages, each with its own small script, all sharing one central data module:

- **`index.html`** — the public landing page with a portal chooser (Customer, Employee) and an illustrative live smart-meter animation.
- **`css/`** — `style.css` (layout and theme), `components.css` (buttons, tables, cards, badges, footer) and `landing.css` (landing page).
- **`js/data.js`** — the single source of truth. It exposes one global object, `EMS`, that holds all entities (customers, employees, policies, bills, complaints, payments) and every function that reads or mutates them. Data is serialized to `localStorage` under the key `ems_data_v2`. Positions and their permissions are defined here.
- **`js/chrome.js`** — shared "page chrome": it renders the staff top-navigation bar from the signed-in employee's position (so each person sees only the links their position allows), fills the identity badge, wires "Log out", and appends the site footer to every page.
- **`js/validation.js`** — a small reusable validation helper (`V`) used by all forms.
- **`customer/`, `employee/`, `admin/`** — the functional pages, each `*.html` paired with a matching `js/<area>/<name>.js`.

Architecturally, a typical page script does three things: (1) guard access via `EMS.requireRole` / `EMS.requirePerm`; (2) read data from `EMS`; (3) build table rows / views as HTML and inject them into the page. There is no client-side router or framework.

```
Browser
 ├─ index.html ──────────────► portal chooser + illustrative meter
 ├─ customer/*  (login, register, dashboard, bills, payment, complaints)
 ├─ employee/*  (login, dashboard/queue, customer lookup, complaint details, update)
 ├─ admin/*     (overview, complaints, billing, customers, policies, team)
 │
 ├─ js/data.js  ── EMS object ──► localStorage ("ems_data_v2")
 ├─ js/chrome.js ── position-driven nav + footer
 └─ js/validation.js ── shared form validation (V)
        session ──► sessionStorage ("ems_session")
```

### 2.2 Product Functions

At a high level, the product provides:

- **Authentication and sessions** for customers and employees (separate logins), with role- and position-based access control.
- **Customer self-service**: register a new connection, view a personal dashboard, view and pay bills (Card or UPI), raise complaints and follow their timelines.
- **Billing**: generate bills from metered units using tiered slab tariffs or a green rooftop rate, plus a fixed service charge, with a live itemised breakdown.
- **Complaint management**: register, assign (route downward by tier), progress and resolve complaints, with a full update history per complaint.
- **Tariff/policy management**: create, edit and delete the tariffs that drive billing.
- **Customer and staff administration**: searchable customer directory, and team management with position assignment.
- **Operational overview**: system-wide statistics (customers, employees, open complaints, revenue collected and outstanding) and an unassigned-complaint work list.

### 2.3 User Classes and Characteristics

| User class | Description | Technical skill | Key capabilities |
|------------|-------------|-----------------|------------------|
| **Customer** | Holder of an electricity account. | Low; general web-literate. | Register, log in, view dashboard, view/pay bills, raise and track complaints. |
| **Field Agent** (staff, tier 1) | Front-line staff who works assigned complaints in the field. | Low–medium. | `work` (personal queue), `lookup` (customer lookup). Cannot assign complaints. |
| **Supervisor** (staff, tier 2) | Runs day-to-day operations. | Medium. | Everything a Field Agent has, plus `overview`, `complaints`, `assign` (to field agents), `billing`, `customers`. No policy or staff management. |
| **Grid Manager** (staff, tier 3) | Full administrative control of the grid. | Medium–high. | All capabilities: `work`, `overview`, `complaints`, `assign` (to supervisors and field agents), `lookup`, `billing`, `customers`, `policies`, `employees`. |

There is no separate "administrator" account type; administrative power lives inside the employee role and is decided entirely by the employee's position.

### 2.4 Operating Environment

- **Client**: A modern desktop or mobile web browser with JavaScript enabled and Web Storage (`localStorage`, `sessionStorage`) available (e.g. current Chrome, Firefox, Edge or Safari).
- **Delivery**: Static files. The app can be opened directly from the filesystem (`index.html`) or served by any static HTTP server (the README suggests `python -m http.server`).
- **Server**: None required. There is no application server, API, or database.
- **Network**: Only an outbound connection to Google Fonts (`fonts.googleapis.com` / `fonts.gstatic.com`) for the Sora and Inter typefaces; the application is otherwise fully functional offline.

### 2.5 Design and Implementation Constraints

- **DC-1** The application MUST be implemented in plain HTML, CSS and vanilla JavaScript with no front-end framework and no build step.
- **DC-2** All application data MUST persist in the browser via `localStorage` under the key `ems_data_v2`; the current session MUST be held in `sessionStorage` under the key `ems_session`.
- **DC-3** Data and behaviour are scoped to a single browser profile on a single device; data is not shared between devices, browsers or users.
- **DC-4** Because there is no back end, all authorization is enforced client-side and is therefore advisory (suitable for a demo, not for production security).
- **DC-5** All entity identifiers MUST follow the seeded prefix scheme and monotonically increasing counters (`C####`, `E###`, `P#`, `B####`, `K####`, `T####`) maintained in the `nextIds` map.
- **DC-6** Complaint routing MUST be strictly downward by position tier; a position may assign only to strictly lower tiers.
- **DC-7** Each functional page consists of one HTML file plus one matching same-named script, sharing the global `EMS` and `V` modules.
- **DC-8** Monetary values are handled and displayed in Indian Rupees (`₹`); phone validation targets 10-digit Indian mobile numbers.

### 2.6 Assumptions and Dependencies

- **AS-1** JavaScript is enabled and Web Storage is available and not full or blocked.
- **AS-2** A single seed dataset is provided; `EMS.resetDemo()` (run from the browser console) restores it, clearing stored data and the session.
- **AS-3** Passwords and card/UPI details are handled in cleartext for demonstration only; no real financial transaction occurs.
- **AS-4** The smart-meter readings on the landing page are decorative simulation, not real telemetry or account data.
- **AS-5** Google Fonts is reachable for the intended typography; if not, the browser falls back to system fonts and the app still functions.
- **AS-6** Only one user is signed in per browser session at a time.

---

## 3. Specific Requirements

Requirement identifiers: functional requirements use `FR-n`; external interface requirements use `UI-n`, `HW-n`, `SW-n`, `COM-n`; non-functional requirements use `NFR-n`. The keywords MUST/SHOULD/MAY are used in their usual sense.

### 3.1 Functional Requirements

#### 3.1.1 Module: Authentication, Session and Access Control

| ID | Requirement |
|----|-------------|
| **FR-1** | The system SHALL provide separate sign-in for customers and employees, authenticating email + password against stored customer or employee records respectively. |
| **FR-2** | On successful login the system SHALL create a session record `{ role, id, name }` in `sessionStorage` and route the user to the appropriate dashboard (customer dashboard or employee dashboard). |
| **FR-3** | On failed login (no matching email/password) the system SHALL display an inline error and SHALL NOT create a session. |
| **FR-4** | The system SHALL provide a "Log out" action on authenticated pages that clears the session and returns the user to the relevant login page. |
| **FR-5** | The system SHALL guard customer pages so that a visitor without a valid `customer` session is redirected to the customer login page. |
| **FR-6** | The system SHALL guard employee pages so that a visitor without a valid `employee` session is redirected to the employee login page. |
| **FR-7** | The system SHALL enforce capability-based page guards for staff: an employee lacking the capability a page requires SHALL be redirected to their own employee dashboard rather than being shown the page. |
| **FR-8** | The system SHALL derive an employee's capabilities from their position, using the fixed position→permission mapping (Grid Manager, Supervisor, Field Agent). |
| **FR-9** | The system SHALL render the staff navigation bar dynamically from the signed-in employee's capabilities, showing only the links that employee is permitted to use, and SHALL display an identity badge with the employee's name and position · department. |

#### 3.1.2 Module: Customer Registration and Account

| ID | Requirement |
|----|-------------|
| **FR-10** | The system SHALL allow a visitor to register a new customer account, capturing name, mobile number, email, service address and password (with password confirmation). |
| **FR-11** | The system SHALL validate registration input: name required and at least 3 characters; a valid 10-digit Indian mobile number; a valid email; a required address; a password of at least 6 characters; and matching password confirmation. |
| **FR-12** | The system SHALL reject registration if the email already belongs to an existing customer, showing an inline message. |
| **FR-13** | On successful registration the system SHALL assign a new customer ID (`C####`) and, if none is supplied, an auto-generated meter number (`MTR-#####`), persist the customer, sign the customer in immediately, and route to the customer dashboard. |

#### 3.1.3 Module: Customer Dashboard and Bills

| ID | Requirement |
|----|-------------|
| **FR-14** | The customer dashboard SHALL display summary statistics for the signed-in customer: total amount due across unpaid bills, the units of the most recent bill (with its month), and the count of open (unresolved) complaints, plus the total complaints raised. |
| **FR-15** | The customer dashboard SHALL display the customer's most recent bills (up to 3, newest first) and most recent complaints (up to 3, newest first), with status badges, and SHALL show friendly empty states when there is no data. |
| **FR-16** | The system SHALL provide a "View & pay bills" page listing all of the signed-in customer's bills with month, units, amount, due date and Paid/Unpaid status. |
| **FR-17** | The system SHALL allow the customer to initiate payment of an Unpaid bill, carrying the selected bill forward as the pending bill for the checkout flow. |

#### 3.1.4 Module: Payments

| ID | Requirement |
|----|-------------|
| **FR-18** | The payment page SHALL present a summary of the pending bill (ID, month, units, due date, total payable) and SHALL let the customer choose a payment method of **Card** or **UPI**. |
| **FR-19** | If no valid pending, unpaid bill is present when a payment page is opened directly, the system SHALL redirect the customer back to the bill list. |
| **FR-20** | For **UPI**, the system SHALL reveal a UPI ID field, validate it against the `name@bank` format, and on success record the payment and mark the bill Paid. |
| **FR-21** | For **Card**, the system SHALL route to a dedicated card-entry page that provides a live card preview and validates a 16-digit card number, cardholder name, MM/YY expiry that is in the future, and a 3-digit CVV before completing payment. |
| **FR-22** | On a successful payment the system SHALL mark the bill as Paid, create a payment transaction record (`T####`) capturing bill, customer, amount, method and timestamp, clear the pending-bill marker, and display a success receipt. |
| **FR-23** | The system SHALL NOT allow a bill already in the Paid state to be paid again. |

#### 3.1.5 Module: Customer Complaints

| ID | Requirement |
|----|-------------|
| **FR-24** | The system SHALL allow a signed-in customer to register a complaint, selecting a type (Power outage, Voltage fluctuation, Billing dispute, Meter fault, Damaged line / pole, Other) and entering a description. |
| **FR-25** | The system SHALL validate that a complaint type is chosen and the description is provided and at least 15 characters. |
| **FR-26** | On submission the system SHALL create a complaint (`K####`) in status **Open**, unassigned, timestamped, with an initial "Complaint registered" entry in its update history, and confirm inline with a link to the status page. |
| **FR-27** | The system SHALL provide a complaint status page showing each of the customer's complaints with its type, description, current status and full chronological timeline of updates (including notes added by staff). |

#### 3.1.6 Module: Employee Work Queue

| ID | Requirement |
|----|-------------|
| **FR-28** | The employee dashboard ("My work") SHALL display the signed-in employee's personal complaint queue and per-status counts (Assigned, In Progress, Resolved) for complaints assigned to them. |
| **FR-29** | For each complaint in the queue the system SHALL provide a "View" action (complaint details) and, when the complaint is not Resolved, an "Update" action. |
| **FR-30** | The system SHALL provide a complaint details page (reachable by complaint ID) showing the complaint and its timeline. |
| **FR-31** | The system SHALL allow an employee to update a complaint that is not already Resolved, setting its status to **In Progress** or **Resolved** and requiring a customer-facing note of at least 10 characters; the update SHALL be appended to the complaint's history with a timestamp and returned to the customer's view. |

#### 3.1.7 Module: Customer Lookup (Staff)

| ID | Requirement |
|----|-------------|
| **FR-32** | The system SHALL provide staff with a customer lookup that searches the directory by name, email or meter number and, for each match, shows the customer's recent bills (with unpaid total) and recent complaints. |

#### 3.1.8 Module: Administrative Overview

| ID | Requirement |
|----|-------------|
| **FR-33** | The overview dashboard (capability `overview`) SHALL display system-wide statistics: total customers, total employees, count of open complaints (with the number still unassigned), total revenue collected (sum of Paid bills) and total amount outstanding (sum of Unpaid bills). |
| **FR-34** | The overview dashboard SHALL list all unassigned (Open) complaints with customer, type and creation time, newest first, and SHALL show an empty state when none remain. |

#### 3.1.9 Module: Complaint Management and Routing

| ID | Requirement |
|----|-------------|
| **FR-35** | The complaint management page (capability `complaints`) SHALL list all complaints with customer, type, status and assignee. |
| **FR-36** | For an Open complaint, a staff member holding the `assign` capability SHALL be offered a dropdown of assignable employees and SHALL be able to route the complaint to one of them. |
| **FR-37** | The set of assignable employees SHALL be limited to staff on a strictly lower tier than the assigning employee (Grid Manager → Supervisors and Field Agents; Supervisor → Field Agents; Field Agent → none). |
| **FR-38** | On assignment the system SHALL set the complaint's status to **Assigned**, record the assignee, and append an "Assigned to …" entry to the complaint history. |
| **FR-39** | Staff without the `assign` capability, or with no eligible lower-tier staff, SHALL see the complaint's assignment state (e.g. "Awaiting assignment") rather than an assignment control. |

#### 3.1.10 Module: Billing (Bill Generation)

| ID | Requirement |
|----|-------------|
| **FR-40** | The billing page (capability `billing`) SHALL let staff generate a bill for a selected customer by entering metered units, a billing month (defaulting to the current month) and a due date (defaulting to 21 days out), and choosing a tariff mode of **Standard slabs** or **Green rooftop**. |
| **FR-41** | The system SHALL compute the bill from live tariff rates: in **Standard** mode, the first 200 units at the Slab A rate and the remainder at the Slab B rate; in **Green** mode, all units at the flat green rate; and SHALL add a fixed service charge (₹50) on top. |
| **FR-42** | The billing page SHALL show a live, itemised breakdown (per-slab lines, service charge and total) that updates as the units or tariff mode change. |
| **FR-43** | On confirmation the system SHALL create a bill (`B####`) in status **Unpaid** for the selected customer, which appears immediately on the customer's bills page and dashboard, and SHALL show it in a recent-bills log. |
| **FR-44** | The tariff rates used for billing SHALL be read from the policy records (matched by policy ID, then by keyword) so that editing a policy changes the pricing of subsequently generated bills; sensible fallback rates SHALL apply if a policy has been removed. |

#### 3.1.11 Module: Tariff / Policy Management

| ID | Requirement |
|----|-------------|
| **FR-45** | The policy management page (capability `policies`) SHALL list all tariff policies with name, description and per-unit rate. |
| **FR-46** | The system SHALL allow a permitted staff member to add a new policy (`P#`), edit an existing policy's fields, and delete a policy. |

#### 3.1.12 Module: Customer Management

| ID | Requirement |
|----|-------------|
| **FR-47** | The customer management page (capability `customers`) SHALL present a searchable customer directory filtering by name, email or meter number, showing ID, name, email, phone, meter number and address. |
| **FR-48** | The system SHALL allow a permitted staff member to remove a customer account, with confirmation. |

#### 3.1.13 Module: Team (Employee) Management

| ID | Requirement |
|----|-------------|
| **FR-49** | The team management page (capability `employees`) SHALL list all employees with ID, name, email, position (as a tier-styled badge), department and a count of their open (unresolved) complaints. |
| **FR-50** | The system SHALL allow a permitted staff member to add a new employee (`E###`), selecting the new employee's position from the defined positions (defaulting to Field Agent). |
| **FR-51** | The system SHALL allow a permitted staff member to remove an employee, with confirmation; on removal, any of that employee's non-resolved complaints SHALL be returned to the unassigned Open queue. |

#### 3.1.14 Module: Data Persistence and Reset

| ID | Requirement |
|----|-------------|
| **FR-52** | The system SHALL persist all entities to `localStorage` and reload them on startup, seeding the store from a fixed dataset on first run. |
| **FR-53** | The system SHALL provide a reset function (`EMS.resetDemo()`) that clears stored data and the session and restores the seed dataset. |
| **FR-54** | The system SHALL assign new entity identifiers from monotonic per-entity counters so identifiers remain unique within the store. |

### 3.2 External Interface Requirements

#### 3.2.1 User Interfaces

| ID | Requirement |
|----|-------------|
| **UI-1** | The system SHALL present a responsive web UI styled by `style.css`, `components.css` and `landing.css`, using the Sora and Inter typefaces with system-font fallbacks. |
| **UI-2** | The system SHALL present a landing page with a portal chooser (Customer, Employee) and an illustrative animated smart-meter panel; the animation SHALL be suppressed when the browser signals a reduced-motion preference. |
| **UI-3** | Data-heavy screens SHALL use consistent tables, cards and status **badges** (whose CSS class is derived from the status text) for bill status, complaint status and staff position/tier. |
| **UI-4** | Forms SHALL show inline, per-field validation errors, display the first failing message per field, and clear errors live as the user corrects input. |
| **UI-5** | The staff top navigation and identity badge SHALL be rendered consistently across staff pages from shared page chrome, reflecting the signed-in employee's position. |
| **UI-6** | Every page SHALL include a consistent site footer rendered from shared page chrome. |

#### 3.2.2 Hardware Interfaces

| ID | Requirement |
|----|-------------|
| **HW-1** | The system requires only a device capable of running a modern web browser (desktop or mobile); it interfaces with no specialised hardware. |
| **HW-2** | The system does not interface with real electricity meters; metered units are entered manually by staff, and the landing-page meter is simulated. |

#### 3.2.3 Software Interfaces

| ID | Requirement |
|----|-------------|
| **SW-1** | The system SHALL run in a standards-compliant web browser and depends on no server-side software, database or runtime. |
| **SW-2** | The system SHALL use the browser Web Storage API — `localStorage` (key `ems_data_v2`) for durable data and `sessionStorage` (key `ems_session`) for the active session. |
| **SW-3** | The system SHALL depend on no third-party JavaScript libraries or frameworks; the only external asset is the Google Fonts stylesheet. |

#### 3.2.4 Communications Interfaces

| ID | Requirement |
|----|-------------|
| **COM-1** | The system SHALL operate without any application network calls; the only outbound request is to Google Fonts (`fonts.googleapis.com` / `fonts.gstatic.com`) over HTTPS, and the application SHALL remain functional if that request fails. |
| **COM-2** | The system MAY be served over HTTP/HTTPS by any static file server, or opened directly from the local filesystem. |

### 3.3 Non-Functional Requirements

#### 3.3.1 Performance

| ID | Requirement |
|----|-------------|
| **NFR-1** | Page interactions (login, navigation, table rendering, bill computation) SHALL complete effectively instantaneously (well under one second) for the demo-scale dataset, since all data is in-memory/local. |
| **NFR-2** | The live billing breakdown SHALL recompute and update on each change to units or tariff mode without a page reload. |

#### 3.3.2 Security

| ID | Requirement |
|----|-------------|
| **NFR-3** | The system SHALL enforce role- and capability-based access on every protected page via the shared guards, redirecting unauthenticated or unauthorized users away from pages they may not use. |
| **NFR-4** | The system SHALL restrict complaint routing to strictly lower tiers, preventing lateral or upward assignment. |
| **NFR-5** | The system SHALL keep the active session in `sessionStorage` so that closing the browser session ends the login. |
| **NFR-6** | It is a known and accepted limitation that, being front-end-only, credentials and card/UPI details are stored/handled in cleartext and all authorization is client-side; the system is therefore suitable for demonstration only and MUST NOT be used with real personal, credential or payment data. |

#### 3.3.3 Usability

| ID | Requirement |
|----|-------------|
| **NFR-7** | The UI SHALL present clear, friendly empty states, inline validation feedback and status badges so that both customers and staff can operate the system with minimal training. |
| **NFR-8** | Staff SHALL be shown only the navigation and controls their position permits, reducing the chance of unauthorized or erroneous actions. |
| **NFR-9** | The interface SHALL respect the user's reduced-motion preference for decorative animation. |

#### 3.3.4 Reliability

| ID | Requirement |
|----|-------------|
| **NFR-10** | Data SHALL survive page navigation and browser reloads via `localStorage`. |
| **NFR-11** | The system SHALL degrade gracefully when a page is entered out of its normal flow (e.g. a payment page opened with no pending bill redirects to the bill list; updating an already-resolved complaint redirects to the queue). |
| **NFR-12** | A deterministic reset (`EMS.resetDemo()`) SHALL restore a known-good seed state at any time. |

#### 3.3.5 Maintainability

| ID | Requirement |
|----|-------------|
| **NFR-13** | Application state and business logic SHALL be centralized in a single module (`EMS` in `js/data.js`) exposing a well-defined API, with per-page scripts limited to guarding, reading and rendering. |
| **NFR-14** | Cross-cutting UI (staff navigation, identity badge, footer) SHALL be centralized in shared chrome so pages do not duplicate it, and each HTML page SHALL have exactly one matching same-named script. |
| **NFR-15** | Positions and their permissions SHALL be defined in one place so that authorization can be changed centrally. |

#### 3.3.6 Portability

| ID | Requirement |
|----|-------------|
| **NFR-16** | The system SHALL run on any modern browser on any operating system, requiring no installation, build step or server. |
| **NFR-17** | The system SHALL be deployable as static files to any static host or CDN, or runnable directly from the filesystem. |

---

## 4. Appendices

### Appendix A — Data Model Overview

All data is held in one object persisted to `localStorage` (key `ems_data_v2`) and seeded on first run. Identifiers are issued from the `nextIds` counter map.

**Entities and key fields:**

| Entity | Key fields | Notes |
|--------|-----------|-------|
| **Customer** | `id` (`C####`), `name`, `email`, `phone`, `address`, `meterNo` (`MTR-#####`), `password` | Email is unique; meter number auto-generated if absent. |
| **Employee** | `id` (`E###`), `name`, `email`, `phone`, `dept`, `position`, `password` | `position` is one of the defined positions; capabilities derive from it. |
| **Policy (Tariff)** | `id` (`P#`), `name`, `ratePerUnit`, `description` | Drives the billing engine; matched by ID then keyword. |
| **Bill** | `id` (`B####`), `customerId`, `month`, `units`, `amount`, `dueDate`, `status` | `status` ∈ {Paid, Unpaid}; created Unpaid. |
| **Complaint** | `id` (`K####`), `customerId`, `type`, `description`, `status`, `assignedTo`, `createdAt`, `updates[]` | `status` ∈ {Open, Assigned, In Progress, Resolved}; `updates[]` = timeline of `{ at, what, note }`. |
| **Payment** | `id` (`T####`), `billId`, `customerId`, `amount`, `method`, `date` | `method` ∈ {Card, UPI}; created when a bill is paid. |
| **nextIds** | `customer, employee, policy, bill, complaint, payment` | Monotonic ID counters. |

**Relationships:**

- A **Customer** has many **Bills**, many **Complaints**, and (through bills) many **Payments**.
- A **Bill** belongs to one Customer and, once paid, has one **Payment**.
- A **Complaint** belongs to one Customer and may be assigned to one **Employee**; it carries an ordered list of update events.
- An **Employee** holds one **Position**; a Position grants a set of capabilities and a tier.
- A **Policy** supplies the per-unit rates consumed by the billing engine.

**Positions and capabilities:**

| Position | Tier | Capabilities |
|----------|------|--------------|
| Grid Manager | 3 | `work`, `overview`, `complaints`, `assign`, `lookup`, `billing`, `customers`, `policies`, `employees` |
| Supervisor | 2 | `work`, `overview`, `complaints`, `assign`, `lookup`, `billing`, `customers` |
| Field Agent | 1 | `work`, `lookup` |

**Billing rules:**

- **Standard slabs:** first 200 units at the Slab A rate; remaining units at the Slab B rate.
- **Green rooftop:** all units at the flat green rate.
- **Service charge:** a fixed ₹50 added to every bill.
- Rates are read live from the policy table (fallbacks: Slab A ₹4.50, Slab B ₹6.25, Green ₹3.75).

**Complaint lifecycle:**

```
Open ──(assign, downward only)──► Assigned ──► In Progress ──► Resolved
  ▲                                                             
  └── returns to Open if the assigned employee is removed (if not yet Resolved)
```

### Appendix B — Glossary

See [Section 1.3](#13-definitions-acronyms-and-abbreviations) for the full list of definitions, acronyms and abbreviations. Key terms in brief:

- **Position / Tier** — a staff role and its numeric rank; determines capabilities and the ceiling for downward complaint routing.
- **Capability (permission)** — a named right that gates navigation links, page access and controls.
- **Slab** — a consumption band priced at its own per-unit rate.
- **Tariff / Policy** — a named per-unit rate record driving bill computation.
- **Pending bill** — the bill selected for the checkout flow, carried in `sessionStorage` between the bill list and payment pages.
- **Seed data / reset** — the fixed starting dataset and the `EMS.resetDemo()` operation that restores it.

---

*End of document — VoltGrid EMS Software Requirements Specification, Version 1.0, 2026-08-29.*
