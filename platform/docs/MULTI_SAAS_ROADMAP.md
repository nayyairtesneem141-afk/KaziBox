# KaziBox Multi-SaaS Cross-Module Integration Roadmap

## 1. Architectural Foundation & Tenant Boundaries

KaziBox operates on a strict **One-Account, One-Workspace** architecture:
- **Shared Identity:** User authentication is handled centrally (`auth.users`, `profiles`).
- **Workspace Isolation:** Every business transaction, record, and module state is strictly bound to `company_id`.
- **Decoupled Module Storage:** Modules store domain-specific tables (e.g. `garage_vehicles`, `hotel_rooms`, `salon_appointments`) without direct unconstrained cross-database joins.
- **Asynchronous Cross-Module Event Bus:** Modules communicate via the typed `crossModuleEventBus` ([`platform/lib/events/cross-module.ts`](file:///g:/data/KaziBox/platform/lib/events/cross-module.ts)).
- **Free Tools Independence:** All 50 utility micro-tools (QR code, Image Compressor, PDF converter, etc.) remain permanently free and execute client-side or statelessly without requiring a paid SaaS subscription.

---

## 2. Event Dispatch Model & Safeguards

```
[Module A (e.g., Garage Auto)]
       │
       ▼ Event: sale.completed { companyId, invoiceId, items, total }
[crossModuleEventBus]
   ├── Tenant Boundary Check (companyId must match)
   ├── Loop Prevention Circuit Breaker (max depth <= 3)
   ├── Idempotency Check (unique eventId)
   └── Audit Log Recording
       │
       ├──► [Module B (e.g., Accounting / Comptabilité)] -> Records Journal Entry
       └──► [Module C (e.g., Inventory / Stock)] -> Decrements Part Quantities
```

### Safety Controls:
1. **Recursion Guard:** If Module A triggers Module B, which triggers Module C, which attempts to trigger Module A, the event bus halts execution when `depth > 3`.
2. **Idempotency:** Webhook and event replays are discarded using `processedEventIds`.
3. **Tenant Enclosure:** Event handlers reject any payload where `event.companyId !== handler.companyId`.

---

## 3. Phased Integration Roadmap

### Phase 1: Billing & Flex Entitlement Alignment (Current Phase)
- Implement KaziBox Flex pay-as-you-can duration engine.
- Configurable admin pricing tiers based on paid SaaS counts (free tools excluded).
- Common expiration timestamp across all active modules in workspace.
- Event bus foundation created.

### Phase 2: Point of Sale (POS) & Inventory Sync (Upcoming)
- **Trigger Event:** `pos.sale_completed` or `garage.work_order_closed`
- **Subscriber:** `inventory` module
- **Action:** Decrements stock levels of parts or retail products sold.
- **Rollback:** On `pos.sale_refunded`, automatically restores inventory quantity.

### Phase 3: Commercial Transactions & Invoicing Pipeline (Upcoming)
- **Trigger Event:** `hotel.booking_checked_out` or `salon.appointment_completed`
- **Subscriber:** `invoicing` / `facturation` module
- **Action:** Automatically generates official OHADA-compliant invoice and PDF receipt with QR verification.

### Phase 4: Consolidated Executive Multi-Activity Dashboard (Future)
- **Subscriber:** Platform Analytics Dashboard
- **Action:** Aggregates real-time KPIs across all subscribed business activities (e.g. Hotel occupancy + Garage daily revenue + Salon bookings) into a unified executive view for business owners.
