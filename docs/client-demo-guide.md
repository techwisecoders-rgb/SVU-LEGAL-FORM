# SVU Developers — Client Demo Walkthrough

Use this guide to present the enhanced website as a premium service experience. The steps below demonstrate the public interface without relying on fictional performance statistics or pretending that a property has been verified.

## Suggested 5–7 minute walkthrough

1. **Start at the homepage.** Introduce the navy/ivory/champagne visual identity, responsive hero, primary actions and the scope-first message.
2. **Open Services.** Hover over or keyboard-focus the Services navigation item to show the grouped mega-menu for property checks, documents/transactions, disputes and guidance.
3. **Build a property preparation plan.** In the interactive Property Navigator, select a property type, transaction stage and state. Click `Build my preparation plan`. Explain that this organizes possible questions; it does not search government records or perform legal verification.
4. **Explore the services directory.** Search terms such as `plot`, `agreement`, `agricultural` or `dispute`, then use the category filters. Choose a service to open the richer detail page.
5. **Show the client workspace preview.** Open `Checklist`, `Documents` and `Timeline`. The sample statuses are deliberately labelled demo content. Mark checklist items to demonstrate the progress interaction. This preview does not write to the database.
6. **Explore the workflow navigator.** Select each stage to explain how intake, scope confirmation, private document exchange and reporting are intended to fit together.
7. **Close with knowledge and action.** Show the free knowledge centre, expandable FAQs and the request/consultation actions.

## What is interactive now

- Search and category filtering in the service directory.
- Property preparation checklist generated from selected property type, stage and state context.
- Customer workspace tab switcher for checklist, document register and timeline presentation.
- Local checklist progress and process-step navigation.
- Expandable FAQs, responsive mobile menu, desktop services mega-menu, and mouse/touch line-trail animation.

## Important demo boundaries

- The homepage's preparation tool is local UI logic. It does not query state portals, registries, revenue systems or court records.
- The workspace preview is illustrative sample data. It must not be described as a real client case or live database dashboard.
- Any actual legal finding must be supported by source records, a defined search scope and appropriate professional review.
- Real authentication, customer dashboards, private document APIs, service requests, bookings, cases and payment flows are separate application workflows. Demonstrate those only after configuring the database, email and other required services.
- Do not show unconfigured payment controls as proof that Razorpay credentials or merchant approval are active.

## Before presenting externally

- Replace remote demo imagery with company-owned or appropriately licensed assets and retain license evidence.
- Add verified company contact details and any legally permitted professional credentials only after checking them.
- Review prices, taxes, cancellation terms, privacy notices, service scope and legal disclaimers with the appropriate professionals.
- Run the project typecheck, production build and integration tests in an environment with dependencies and PostgreSQL configured.
