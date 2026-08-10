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
- Correct a bill freely before saving; undo immediately after saving
- Mark a wrong transaction invalid (nobody deletes)
- Daily dashboard: order count, revenue, cash/UPI split, items sold, top items
- Menu CRUD with an availability toggle
- Public menu page driven by the same data
- CSV export of a date range

**Out of scope**

- Customer login, online ordering, payments
- Inventory or stock tracking
- Notifications
- Offline queueing
- Historical reporting beyond the current day (deferred, not designed against)
- **GST invoicing and billing compliance.** This system records sales for the
  owner's own visibility. It is not a compliant invoicing system, does not
  produce tax invoices, and should not be treated as the books of record for
  filing. If GST invoicing becomes necessary, that is a separate system with its
  own legal requirements — not an extension of this one.

**Deferred, not rejected**

- *Repeat last order.* Optimises a problem not yet observed, and adds persistent
  state to the fastest path in the app. Revisit after a week of real orders shows
  whether the same bill genuinely recurs.
- *Item-level reporting.* `order_items` already snapshots everything needed for
  best-selling items and a breakfast-versus-lunch split. This needs no schema
  change when the time comes — only queries and screens.

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
| `customer_name` | text | optional, catering only |
| `customer_phone` | text | optional, catering only |
| `total_amount` | numeric(10,2) | NOT NULL, CHECK >= 0 |
| `payment_mode` | text | NOT NULL, `cash` or `upi` |
| `status` | text | NOT NULL, default `valid`; `valid` or `invalid` |
| `invalidated_at` | timestamptz | NULL until marked invalid |
| `created_by` | uuid | references `auth.users(id)` |
| `created_at` | timestamptz | default `now()` |

A CHECK constraint enforces the shape of each type: `counter` orders must have a
NULL `description`, `catering` orders must have a non-NULL one.

`customer_name` and `customer_phone` are optional and used only for catering, so
a booking can be traced back to who it was for. They are personal data; the
`orders` table is unreadable to anonymous users, and they are the only columns
here that would matter in a leak.

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
| Undo the order just saved | yes | yes |
| Edit an amount | no | yes |
| Delete a transaction | no | no |
| Toggle item availability | yes | yes |
| Add / edit / price menu items | no | yes |
| See daily totals | yes | yes |
| Export CSV | no | yes |

Staff hold **no UPDATE grant on `orders` or `menu_items` at all**. Their two
permitted changes to existing rows go through `SECURITY DEFINER` functions, each
of which can do exactly one thing:

- `mark_order_invalid(p_order_id uuid)` — sets `status = 'invalid'` and stamps
  `invalidated_at`. Nothing else.
- `set_item_availability(p_item_id uuid, p_available boolean)` — sets
  `is_available`. Cannot touch name, price or category.

This function-only pattern is why the restrictions are enforceable rather than
cosmetic. RLS cannot express "you may update this column but not that one", so
granting staff a general UPDATE and hiding the other fields in the UI would leave
the rule bypassable by a hand-crafted request. With no UPDATE grant at all, there
is no such path.

The availability toggle is deliberately staff-accessible: a juice selling out
mid-service is an everyday occurrence, and routing it through the owner would
mean the public menu is wrong for hours at a time.

## Security

1. RLS enabled on every table, default deny.
2. `menu_items` — SELECT granted to `anon` and `authenticated` (a menu is public).
   INSERT/UPDATE/DELETE restricted to `owner`; staff change availability only
   through `set_item_availability()`.
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

### Correcting mistakes

Staff make mistakes constantly at a counter, so correction is a first-class path,
not an exception path.

**Before saving** — the running bill is fully editable. Adjust quantities, remove
a line, switch payment mode, clear the whole bill. Nothing has been recorded, so
nothing needs auditing.

**Immediately after saving** — the just-saved order shows an **Undo** button. One
tap marks it invalid *and* reloads its lines back into the entry form, ready to
fix and re-save.

Undo does not delete. A delete window was considered and rejected: it would
contradict the never-delete invariant, and it would not actually solve the
friction it targets, since a deleted bill still has to be retyped from scratch.
Reloading the lines into the form is both faster than re-entry and leaves the
audit trail intact — the mistake stays visible as an invalid row, with the
correction recorded next to it.

**Later** — Mark invalid, from the day's list. The row stays visible, struck
through, out of the totals.

## Screens

### `admin.html`

Mobile-first, one thumb, no page reloads.

**Login** — email and password.

**Orders tab** (both roles)

- Type toggle: Counter | Catering
- Counter: tap items from a category-grouped list into a running bill — one tap
  adds, no dropdown — `+/-` on quantity, remove a line, live total, Cash/UPI, Save
- Catering: description, amount, payment mode, optional customer name and phone,
  Save
- Today: order count, revenue, UPI split, cash split, items sold, top 3 items
- The just-saved order shows Undo (invalidate and reload into the form)
- Today's orders, newest first, each with Mark invalid. Invalid rows stay
  visible, struck through, excluded from totals.

**Menu tab**

- Staff see the item list with availability toggles only. No prices editable, no
  add or delete, enforced by the database.
- Owner additionally gets add, edit, price and category changes.

**Export** (owner only): pick a date range, download CSV of orders and their
line items. Money data with no way out of the system is a single point of
failure — this covers accounting handoff, and gives an off-Supabase copy without
running a backup system.

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

`verify_rls.sql` must confirm that each of these is **rejected**:

- anonymous SELECT on `orders`
- anonymous SELECT on `order_items`
- staff UPDATE of `orders.total_amount`
- staff UPDATE of `menu_items.price`
- staff INSERT into `menu_items`
- any DELETE on `orders`

and that each of these **succeeds**:

- staff INSERT of an order via `create_counter_order()`
- staff calling `mark_order_invalid()`
- staff calling `set_item_availability()`
- anonymous SELECT on `menu_items`

If any assertion goes the wrong way, the deployment is misconfigured.

Manual QA checklist:

- Staff login can toggle availability but cannot change a price
- Staff login cannot edit an amount
- Undo on a just-saved order invalidates it and refills the entry form
- An order entered after 8:00pm IST appears on that day's dashboard, not the next
- Marking an order invalid removes it from revenue while it stays visible
- Invalid orders are excluded from items-sold and top-items figures, not just
  from revenue
- A catering order appears in the day's revenue alongside counter sales
- Public `menu.html` shows available items only, and reflects a price change
- CSV export opens in a spreadsheet with totals matching the dashboard
- Signing out and reloading `admin.html` shows the login screen, not data

## Known risks, accepted

- **Shared staff account** gives owner-vs-staff attribution, not per-person.
  Upgrading to individual logins needs no schema change — only extra `profiles`
  rows.
- **RLS is load-bearing.** A policy mistake exposes sales data, hence
  `verify_rls.sql` as a gate rather than a nicety.
- **No historical reporting** beyond the current day. The schema supports it and
  CSV export covers the practical need; no screen does.
- **CSV export is manual.** Nobody is obliged to run it, so an off-Supabase copy
  exists only as often as someone remembers. Automating it needs a scheduled job,
  which means a server — deliberately out of scope for now.

## Open items

- Menu categories are fixed at Breakfast, Lunch, Drinks, Shelf. Confirm against
  the real menu before seeding.
- Opening hours and the exact shop address are still unknown, and are needed for
  `index.html` rather than this system.
