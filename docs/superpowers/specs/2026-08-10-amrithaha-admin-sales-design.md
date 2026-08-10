# Amrithaha Admin + Sales Tracking — Design

**Date:** 2026-08-10
**Status:** Approved, ready for implementation planning

## Objective

Give the shop a backend system to track daily sales. Staff log every order at the
counter as it happens; the owner sees the day's revenue and its cash/UPI split
without adding anything up by hand.

Menu management exists to serve that goal: it drives the order-entry list, and as
a byproduct it publishes a public menu page that never goes stale.

## Users

| Role | Who | Accounts |
|---|---|---|
| `owner` | Shop owner | 1 |
| `staff` | Whoever is at the counter | 1 shared, initially |

Both roles log orders. Only the owner changes money or the menu.

## Scope

**In scope**

- Log counter orders as bills with multiple line items
- Log catering orders as a description plus a value
- Mark a wrong transaction invalid (nobody deletes)
- Daily dashboard: order count, revenue, cash/UPI split
- Menu CRUD with an availability toggle
- Public menu page driven by the same data

**Out of scope**

- Customer login, online ordering, payments
- Inventory or stock tracking
- Notifications
- Offline queueing
- Historical reporting beyond the current day (deferred, not designed against)

## Success criteria

- A counter order is logged in under five seconds
- A menu change appears on the public page with no code edit
- A staff login cannot alter an amount, by any route including a hand-crafted request
- The daily total is correct for orders taken late in the evening (IST boundary)

## Architecture

Static pages in the existing repository, served by GitHub Pages exactly as today.
The browser talks directly to Supabase. There is no server of our own, so
**Postgres Row Level Security is the entire security boundary**.

```
index.html      marketing site (unchanged)
menu.html       public menu, reads available items
admin.html      login gate -> Orders tab | Menu tab
js/config.js    Supabase URL + anon key (public by design)
js/db.js        shared data access
sql/            schema, policies, seed, RLS verification
```

Rationale for staying static: the driver is sales visibility for one shop and two
users. A Next.js port would mean introducing build tooling to a repo that has
none, rewriting the hand-written `index.html`, and migrating hosting — all before
the first order is logged. Client-direct-to-Supabase is the model Supabase is
designed for. If the system outgrows it, a separate Next.js admin app is the next
step and this schema carries over unchanged.

## Data model

### `profiles`

Maps a login to a role.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK, references `auth.users(id)` |
| `role` | text | `owner` or `staff`, NOT NULL |
| `display_name` | text | |
| `created_at` | timestamptz | default `now()` |

Role lookups run through a `SECURITY DEFINER` function so that policies on other
tables can read a role without triggering recursive RLS evaluation on `profiles`.

### `menu_items`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `name` | text | NOT NULL |
| `category` | text | NOT NULL — Breakfast, Lunch, Drinks, Shelf |
| `price` | numeric(10,2) | NOT NULL, CHECK >= 0 |
| `is_available` | boolean | NOT NULL, default true |
| `display_order` | int | NOT NULL, default 0 |
| `created_at` | timestamptz | default `now()` |

Serves the order-entry list, the public menu, and daily availability toggles.
Adding a shelf item (a new juice) is one row; taking it off today's menu is one
toggle.

### `orders`

One row per customer bill.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `business_date` | date | NOT NULL, IST — see below |
| `order_type` | text | NOT NULL, `counter` or `catering` |
| `description` | text | catering only; NULL for counter |
| `total_amount` | numeric(10,2) | NOT NULL, CHECK >= 0 |
| `payment_mode` | text | NOT NULL, `cash` or `upi` |
| `status` | text | NOT NULL, default `valid`; `valid` or `invalid` |
| `invalidated_at` | timestamptz | NULL until marked invalid |
| `created_by` | uuid | references `auth.users(id)` |
| `created_at` | timestamptz | default `now()` |

A CHECK constraint enforces the shape of each type: `counter` orders must have a
NULL `description`, `catering` orders must have a non-NULL one.

### `order_items`

One row per line on a counter bill. Catering orders have none.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `order_id` | uuid | references `orders(id)` ON DELETE CASCADE |
| `menu_item_id` | uuid | references `menu_items(id)` ON DELETE SET NULL |
| `item_name` | text | NOT NULL — snapshot |
| `unit_price` | numeric(10,2) | NOT NULL — snapshot |
| `quantity` | int | NOT NULL, CHECK > 0 |
| `line_total` | numeric(10,2) | generated: `unit_price * quantity` |

### Four decisions that are expensive to retrofit

**Line items snapshot `item_name` and `unit_price`.** Raising dosa from ₹80 to
₹90 must not rewrite last month's revenue. `menu_item_id` survives for reporting
but is nullable, so deleting a menu item never destroys sales history.

**Sales are voided, never deleted.** `status` marks a mistake and the row stays.
Deleting money records is how books stop reconciling, and a deleted row is
unattributable.

**`business_date` is stored explicitly in IST.** Supabase runs UTC; an 8:30pm IST
order is already tomorrow in UTC and would land on the wrong day's dashboard.
The column default computes `(now() AT TIME ZONE 'Asia/Kolkata')::date` rather
than relying on the client clock.

**`total_amount` is stored on the bill** rather than recomputed from lines, so
the dashboard is a single fast query. Line items remain available to verify
against.

## Permissions

| Action | staff | owner |
|---|---|---|
| Add counter order | yes | yes |
| Add catering order | yes | yes |
| Mark transaction invalid | yes | yes |
| Edit an amount | no | yes |
| Delete a transaction | no | no |
| Add / edit menu items | no | yes |
| See daily totals | yes | yes |

Staff hold **no UPDATE grant on `orders` at all**. "Mark invalid" is a
`SECURITY DEFINER` function, `mark_order_invalid(p_order_id uuid)`, whose only
effect is setting `status = 'invalid'` and stamping `invalidated_at`. Because
staff have no other write path to an existing row, the restriction cannot be
bypassed by crafting a request by hand — it is not a hidden button.

## Security

1. RLS enabled on every table, default deny.
2. `menu_items` — SELECT granted to `anon` and `authenticated` (a menu is public).
   INSERT/UPDATE/DELETE restricted to `owner`.
3. `orders`, `order_items` — no `anon` access of any kind. SELECT and INSERT for
   authenticated users; UPDATE for `owner` only; DELETE for nobody.
4. `profiles` — a user may read their own row; only `owner` may write.
5. **Public signups must be disabled in Supabase Auth settings.** Left enabled,
   any stranger can self-register, land in the `authenticated` role, and read the
   sales tables. Accounts are created by the owner by hand. This is a
   configuration step, not code, and it is the easiest part of the design to
   forget.
6. The anon key ships in the repository by design. The `service_role` key never
   does, and must not appear in any client file.

## Order entry and network behaviour

Orders are logged live at a counter on shop wifi. Saves are optimistic but
confirmed: the button moves through *saving* to *saved*, and on failure the bill
**stays on screen with a Retry**. There is no offline queue — real complexity for
a rare case — but the failure mode is a visible retry rather than a sale that
silently vanished.

A counter bill is written as one `orders` row plus its `order_items` rows. These
are inserted through a single `create_counter_order()` function so a bill cannot
be half-written if the connection drops between statements.

## Screens

### `admin.html`

Mobile-first, one thumb, no page reloads.

**Login** — email and password.

**Orders tab** (both roles)

- Type toggle: Counter | Catering
- Counter: tap items from a category-grouped list into a running bill, `+/-` on
  quantity, live total, Cash/UPI, Save
- Catering: description, amount, payment mode, Save
- Today: order count, revenue, UPI split, cash split
- Today's orders, newest first, each with Mark invalid. Invalid rows stay
  visible, struck through, excluded from totals.

**Menu tab** (owner only — hidden for staff and denied by the database
regardless): add item, edit, availability toggle, grouped by category.

### `menu.html`

Public. Reads available items grouped by category, styled with the same tokens as
`index.html` (Fraunces/Poppins, cream and green) so it reads as one site rather
than a bolted-on app.

## Verification

The repository has no test framework and no build step; adding one to a static
site is not proportionate. Verification is therefore SQL-level plus a manual
checklist.

Checked in and re-runnable:

- `sql/schema.sql` — tables, constraints, functions
- `sql/policies.sql` — RLS policies and grants
- `sql/seed.sql` — starting menu items
- `sql/verify_rls.sql` — assertions that must **fail**

`verify_rls.sql` must confirm that each of these is rejected:

- anonymous SELECT on `orders`
- anonymous SELECT on `order_items`
- staff UPDATE of `orders.total_amount`
- staff INSERT into `menu_items`
- any DELETE on `orders`

If any of those succeeds, the deployment is misconfigured.

Manual QA checklist:

- Staff login sees no Menu tab, and cannot edit an amount
- An order entered after 8:00pm IST appears on that day's dashboard, not the next
- Marking an order invalid removes it from revenue while it stays visible
- A catering order appears in the day's revenue alongside counter sales
- Public `menu.html` shows available items only, and reflects a price change
- Signing out and reloading `admin.html` shows the login screen, not data

## Known risks, accepted

- **Shared staff account** gives owner-vs-staff attribution, not per-person.
  Upgrading to individual logins needs no schema change — only extra `profiles`
  rows.
- **RLS is load-bearing.** A policy mistake exposes sales data, hence
  `verify_rls.sql` as a gate rather than a nicety.
- **Menu edits are owner-only**, so staff cannot mark a juice sold out
  mid-service. Easy to relax by granting staff UPDATE on `is_available` alone.
- **No historical reporting** beyond the current day. The schema supports it;
  no screen does.

## Open items

- Menu categories are fixed at Breakfast, Lunch, Drinks, Shelf. Confirm against
  the real menu before seeding.
- Opening hours and the exact shop address are still unknown, and are needed for
  `index.html` rather than this system.
