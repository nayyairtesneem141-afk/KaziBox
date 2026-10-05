# KaziBox (formerly Africa SaaS) — Development Brief
## Common Architecture & Modular SaaS Ecosystem

### 1. Project Vision
KaziBox is designed as one unified, modular business-management platform, not as a collection of disconnected applications. The objective is to create a single environment in which a customer can activate and use one or several business SaaS modules according to their needs.

For example, the same customer may own a hotel, a garage, and a taxi business. With one KaziBox account, the customer can activate the Hotel/Property Rental, Garage, and Taxi/Fleet modules and manage all of them from the same workspace, without logging out or moving between separate systems.

### 2. Common Core Architecture
The common architecture forms the foundation upon which the first SaaS module and all future modules are built. Everything that can be shared is developed once and reused:
- Authentication & Sessions
- Account & Company profiles
- Navigation & Workspace shell
- Settings & Preferences
- Language management (Bilingual FR/EN from Day 1)
- Subscription & billing management
- Notifications
- General KaziBox workspace

**Mandatory PWA Requirement:**
KaziBox and every business SaaS module connected to it must be built as a Progressive Web App (PWA). This is a core architectural requirement, not an optional feature. Each module must remain responsive and installable on compatible smartphones, tablets, and desktop devices. Third-party developers must adhere to the same PWA standard.

### 3. Modules, Workspace & Consolidated View
Each module keeps its own name, identity, and business-specific functions (e.g., Hotel & Property Rental, Garage, Taxi/Fleet Management, Hair Salon, Pharmacy, Restaurant). A user activates only the modules they need.

The architecture supports a consolidated global dashboard. A customer operating several activities can view each activity separately and view consolidated information (such as daily revenue, expenses, and overall performance) across activated modules.

### 4. Subscription & Payment Logic
Subscription billing is centralized at the platform level. Each SaaS module may have its own pricing tier. Multi-module bundles or full catalogue packages will be supported. A customer using several modules makes one consolidated subscription payment.

Crucially, this subscription flow remains strictly separate from customer business transactions. A hotel pays KaziBox for software subscription, while payments made by hotel guests belong to the hotel and go to the hotel's own payment gateway/account.

### 5. French & English from Day One
The platform is fully bilingual from day one: French (default) and English. All menus, buttons, forms, system messages, and modules support both languages without hardcoding. Adding future languages only requires providing a new locale translation file.

### 6. SaaS Discovery & Catalogue
Each module has a standardized presentation page containing its name, logo, short description, main features, pricing, screenshots, and demonstration video (1–2 minutes, bilingual).

### 7. Open Integration Model
New SaaS modules can be added at any time without rebuilding or materially modifying the common core. Third-party developers can create modules adhering to the KaziBox SDK specifications.

### 8. Standardized Integration API / Module API
The API provides a technical contract:
1. Module registration and unique identifier.
2. Metadata definition (name, logo, description, supported languages, pricing, entry route).
3. Recognition of the authenticated user, current workspace, and module access permissions.
4. Activation / deactivation based on workspace subscription.
5. Standardized summary metrics exchange (revenue, expense, activity counters) for the consolidated dashboard.
6. PWA compliance validation.

### 9. Module Registry
An administrative registry mechanism enables registering and configuring new modules dynamically without hardcoding them into the platform core.
