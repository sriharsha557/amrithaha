# Amrithaha Admin + Sales Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff log every counter and catering sale as it happens, and let the owner see the day's revenue and cash/UPI split without adding anything up by hand.

**Architecture:** Static HTML/JS pages added to this existing repository, served by GitHub Pages exactly as today. The browser talks directly to Supabase; there is no server of ours, so Postgres Row Level Security plus `SECURITY DEFINER` functions are the entire security boundary. All writes to existing rows go through functions, never through table grants.

**Tech Stack:** Supabase (Postgres + Auth), `@supabase/supabase-js` v2 loaded from CDN as an ES module, vanilla JS, no build step. Tests run on Node's built-in test runner.

## Global Constraints

- **`index.html` must not be restructured, ported, or refactored.** It is the live marketing site. New pages duplicate its design tokens rather than sharing them. The single permitted edit is the one-line menu link in Task 12.
- **No build step, no bundler.** Pages must work opened directly from GitHub Pages.
- **The `service_role` key must never appear in any file in this repository.** Only the anon key, which is public by design.
- **Public signups must be disabled** in Supabase Auth settings. Accounts are created by hand by the owner.
- **Nothing is ever deleted.** No `DELETE` policy exists on `orders` or `order_items` for any role.
- **Prices are never accepted from the client.** `create_counter_order` reads prices from `menu_items` server-side.
- **`business_date` is IST** (`Asia/Kolkata`, UTC+5:30, no DST).
- Money columns are `numeric(10,2)`. Never floats.
- Categories are exactly: `Breakfast`, `Lunch`, `Drinks`, `Shelf`.
- Roles are exactly: `owner`, `staff`. Payment modes: `cash`, `upi`. Order types: `counter`, `catering`. Status: `valid`, `invalid`.

## File Structure

| Path | Responsibility |
|---|---|
| `sql/schema.sql` | Tables, constraints, indexes |
| `sql/functions.sql` | Role helpers and all write functions |
| `sql/policies.sql` | RLS enable + policies + grants |
| `sql/seed.sql` | Starting menu items |
| `sql/verify_rls.sql` | Security assertions — the gate |
| `js/config.js` | Supabase URL + anon key |
| `js/supabase.js` | Client singleton |
| `js/lib/date.js` | IST business date (pure) |
| `js/lib/money.js` | Currency formatting (pure) |
| `js/lib/html.js` | HTML escaping (pure) |
| `js/lib/amount.js` | Money input parsing (pure) |
| `js/lib/bill.js` | Running bill state (pure) |
| `js/lib/summary.js` | Daily totals + top items (pure) |
| `js/lib/csv.js` | CSV serialisation (pure) |
| `js/auth.js` | Sign in/out, session, role |
| `js/db.js` | All Supabase calls |
| `js/admin.js` | Admin page wiring |
| `js/menu-public.js` | Public menu page wiring |
| `css/app.css` | Design tokens + shared styles for new pages |
| `admin.html` | Login gate, Orders tab, Menu tab, Export |
| `menu.html` | Public menu |
| `tests/*.test.js` | Node tests for `js/lib/*` |
| `package.json` | `{"type":"module"}` only — enables ESM in Node tests |

`js/lib/*` files are pure: no imports, no DOM, no Supabase. That is what makes them testable in Node and is the reason for the split.

---

### Task 1: Database schema

**Files:**
- Create: `sql/schema.sql`
- Create: `package.json`

**Interfaces:**
- Consumes: nothing
- Produces: tables `profiles`, `menu_items`, `orders`, `order_items` with the exact column names used by every later task

- [ ] **Step 1: Create `package.json`**

This exists only so Node treats `js/lib/*.js` as ES modules during tests. GitHub Pages ignores it.

```json
{
  "name": "amrithaha",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test"
  }
}
```

- [ ] **Step 2: Write `sql/schema.sql`**

```sql
-- Amrithaha: tables, constraints, indexes.
-- Run in the Supabase SQL editor. Safe to re-run only on a fresh project.

create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','staff')),
  display_name text,
  created_at timestamptz not null default now()
);

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null check (category in ('Breakfast','Lunch','Drinks','Shelf')),
  price numeric(10,2) not null check (price >= 0),
  is_available boolean not null default true,
  display_order int not null default 0,
  created_at timestamptz not null default now()
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  business_date date not null default ((now() at time zone 'Asia/Kolkata')::date),
  order_type text not null check (order_type in ('counter','catering')),
  description text,
  customer_name text,
  customer_phone text,
  total_amount numeric(10,2) not null check (total_amount >= 0),
  payment_mode text not null check (payment_mode in ('cash','upi')),
  status text not null default 'valid' check (status in ('valid','invalid')),
  invalidated_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  constraint order_type_shape check (
    (order_type = 'counter'  and description is null)
    or (order_type = 'catering' and description is not null)
  )
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  menu_item_id uuid references public.menu_items(id) on delete set null,
  item_name text not null,
  unit_price numeric(10,2) not null check (unit_price >= 0),
  quantity int not null check (quantity > 0),
  line_total numeric(10,2) generated always as (unit_price * quantity) stored
);

create index orders_business_date_idx on public.orders (business_date, status);
create index order_items_order_id_idx  on public.order_items (order_id);
```

- [ ] **Step 3: Run it and verify the IST default**

Paste `sql/schema.sql` into the Supabase SQL editor and run. Then run:

```sql
select (now() at time zone 'Asia/Kolkata')::date as ist_today,
       (now() at time zone 'UTC')::date          as utc_today;
```

Expected: both dates equal during the Indian day; `ist_today` is one day ahead when run between 18:30 and 24:00 UTC. This is the behaviour the whole dashboard depends on.

- [ ] **Step 4: Verify the order shape constraint rejects bad rows**

```sql
-- must FAIL: counter order carrying a description
insert into public.orders (order_type, description, total_amount, payment_mode)
values ('counter', 'should not be allowed', 100, 'cash');
```

Expected: `ERROR: new row for relation "orders" violates check constraint "order_type_shape"`

```sql
-- must FAIL: catering order with no description
insert into public.orders (order_type, total_amount, payment_mode)
values ('catering', 100, 'cash');
```

Expected: same error.

- [ ] **Step 5: Commit**

```bash
git add sql/schema.sql package.json
git commit -m "feat: add database schema for sales tracking"
```

---

### Task 2: Role helpers and write functions

**Files:**
- Create: `sql/functions.sql`

**Interfaces:**
- Consumes: tables from Task 1
- Produces:
  - `public.is_owner() returns boolean`
  - `public.create_counter_order(p_payment_mode text, p_items jsonb) returns uuid`
  - `public.create_catering_order(p_description text, p_amount numeric, p_payment_mode text, p_customer_name text, p_customer_phone text) returns uuid`
  - `public.mark_order_invalid(p_order_id uuid) returns void`
  - `public.set_item_availability(p_item_id uuid, p_available boolean) returns void`

`p_items` is `[{"menu_item_id":"<uuid>","quantity":<int>}, ...]`.

- [ ] **Step 1: Write `sql/functions.sql`**

```sql
-- Amrithaha: role helper + every write path to existing rows.
-- All functions are SECURITY DEFINER so they bypass RLS deliberately and
-- perform their own authorisation. This is why staff need no UPDATE grants.

-- Reads the caller's role. SECURITY DEFINER so policies on other tables can
-- call it without triggering recursive RLS evaluation against profiles.
create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role from public.profiles where id = auth.uid()) = 'owner',
    false
  );
$$;

-- Creates a counter bill and its lines atomically.
-- Prices and names are read from menu_items, never taken from the client.
create or replace function public.create_counter_order(
  p_payment_mode text,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_total    numeric(10,2);
  v_wanted   int;
  v_found    int;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_payment_mode not in ('cash','upi') then
    raise exception 'invalid payment mode: %', p_payment_mode;
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'bill has no items';
  end if;

  v_wanted := jsonb_array_length(p_items);

  select count(*) into v_found
  from jsonb_array_elements(p_items) e
  join public.menu_items m on m.id = (e->>'menu_item_id')::uuid;

  if v_found <> v_wanted then
    raise exception 'bill references % unknown menu item(s)', v_wanted - v_found;
  end if;

  insert into public.orders (order_type, total_amount, payment_mode, created_by)
  values ('counter', 0, p_payment_mode, auth.uid())
  returning id into v_order_id;

  insert into public.order_items
    (order_id, menu_item_id, item_name, unit_price, quantity)
  select v_order_id, m.id, m.name, m.price, (e->>'quantity')::int
  from jsonb_array_elements(p_items) e
  join public.menu_items m on m.id = (e->>'menu_item_id')::uuid;

  select coalesce(sum(line_total), 0) into v_total
  from public.order_items where order_id = v_order_id;

  update public.orders set total_amount = v_total where id = v_order_id;

  return v_order_id;
end;
$$;

-- Creates a catering order: a description and a value, no line items.
create or replace function public.create_catering_order(
  p_description    text,
  p_amount         numeric,
  p_payment_mode   text,
  p_customer_name  text default null,
  p_customer_phone text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_description is null or btrim(p_description) = '' then
    raise exception 'catering order needs a description';
  end if;
  if p_amount is null or p_amount < 0 then
    raise exception 'catering amount must be zero or more';
  end if;
  if p_payment_mode not in ('cash','upi') then
    raise exception 'invalid payment mode: %', p_payment_mode;
  end if;

  insert into public.orders
    (order_type, description, customer_name, customer_phone,
     total_amount, payment_mode, created_by)
  values
    ('catering', btrim(p_description), p_customer_name, p_customer_phone,
     p_amount, p_payment_mode, auth.uid())
  returning id into v_order_id;

  return v_order_id;
end;
$$;

-- The ONLY way staff may change an existing order. Flips status, nothing else.
create or replace function public.mark_order_invalid(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  update public.orders
     set status = 'invalid',
         invalidated_at = now()
   where id = p_order_id
     and status = 'valid';
end;
$$;

-- The ONLY way staff may change a menu item. Cannot touch name, price, category.
create or replace function public.set_item_availability(
  p_item_id   uuid,
  p_available boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_available is null then
    raise exception 'availability must be true or false';
  end if;

  update public.menu_items
     set is_available = p_available
   where id = p_item_id;
end;
$$;
```

- [ ] **Step 2: Run it in the Supabase SQL editor**

Expected: `Success. No rows returned`.

- [ ] **Step 3: Verify a bogus menu item is rejected**

```sql
select public.create_counter_order(
  'cash',
  '[{"menu_item_id":"00000000-0000-0000-0000-000000000000","quantity":1}]'::jsonb
);
```

Expected: `ERROR: bill references 1 unknown menu item(s)`. No order row is created — confirm with `select count(*) from public.orders;`.

- [ ] **Step 4: Verify an empty bill is rejected**

```sql
select public.create_counter_order('cash', '[]'::jsonb);
```

Expected: `ERROR: bill has no items`

- [ ] **Step 5: Commit**

```bash
git add sql/functions.sql
git commit -m "feat: add role helper and order write functions"
```

---

### Task 3: RLS policies and the security gate

**Files:**
- Create: `sql/policies.sql`
- Create: `sql/verify_rls.sql`

**Interfaces:**
- Consumes: tables from Task 1, `is_owner()` from Task 2
- Produces: the security boundary every later task relies on

This is the task where a mistake exposes sales data. The verification script is not optional.

- [ ] **Step 1: Write `sql/policies.sql`**

```sql
-- Amrithaha: Row Level Security. Default deny; every grant is explicit.
--
-- Deliberate omissions, do not "fix" them:
--   * no INSERT policy on orders/order_items -> inserts only via SECURITY
--     DEFINER functions, so the client cannot forge a price
--   * no DELETE policy anywhere -> nobody deletes sales, ever
--   * no UPDATE policy for staff -> their only writes are the two functions

alter table public.profiles    enable row level security;
alter table public.menu_items  enable row level security;
alter table public.orders      enable row level security;
alter table public.order_items enable row level security;

-- ---------- profiles ----------
create policy profiles_read_self on public.profiles
  for select to authenticated
  using (id = auth.uid());

create policy profiles_owner_write on public.profiles
  for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());

-- ---------- menu_items ----------
-- A menu is public information; the website reads it anonymously.
create policy menu_read_all on public.menu_items
  for select to anon, authenticated
  using (true);

create policy menu_owner_insert on public.menu_items
  for insert to authenticated
  with check (public.is_owner());

create policy menu_owner_update on public.menu_items
  for update to authenticated
  using (public.is_owner())
  with check (public.is_owner());

create policy menu_owner_delete on public.menu_items
  for delete to authenticated
  using (public.is_owner());

-- ---------- orders ----------
-- No anon access of any kind.
create policy orders_read on public.orders
  for select to authenticated
  using (true);

create policy orders_owner_update on public.orders
  for update to authenticated
  using (public.is_owner())
  with check (public.is_owner());

-- ---------- order_items ----------
create policy order_items_read on public.order_items
  for select to authenticated
  using (true);

create policy order_items_owner_update on public.order_items
  for update to authenticated
  using (public.is_owner())
  with check (public.is_owner());

-- ---------- function grants ----------
revoke execute on function public.create_counter_order(text, jsonb)  from public, anon;
revoke execute on function public.create_catering_order(text, numeric, text, text, text) from public, anon;
revoke execute on function public.mark_order_invalid(uuid)           from public, anon;
revoke execute on function public.set_item_availability(uuid, boolean) from public, anon;

grant execute on function public.create_counter_order(text, jsonb)   to authenticated;
grant execute on function public.create_catering_order(text, numeric, text, text, text) to authenticated;
grant execute on function public.mark_order_invalid(uuid)            to authenticated;
grant execute on function public.set_item_availability(uuid, boolean) to authenticated;
```

- [ ] **Step 2: Run it, then create the two accounts**

Run `sql/policies.sql`. Then in the Supabase dashboard:

1. **Authentication → Providers → Email: turn OFF "Enable signups".** Skipping this undoes every policy above — anyone could self-register into `authenticated` and read the sales tables.
2. **Authentication → Users → Add user** twice: one owner, one staff. Confirm both emails.
3. Insert their profile rows, substituting the real UUIDs from the Users list:

```sql
insert into public.profiles (id, role, display_name) values
  ('<owner-uuid>', 'owner', 'Owner'),
  ('<staff-uuid>', 'staff', 'Counter');
```

- [ ] **Step 3: Write `sql/verify_rls.sql`**

```sql
-- Amrithaha security gate. Run after any change to policies or functions.
--
-- HOW TO RUN
--   1. Replace <staff-uuid> and <owner-uuid> below with the real UUIDs from
--      Supabase -> Authentication -> Users.
--   2. Paste this ENTIRE file into the Supabase SQL editor and run it once.
--      It seeds fixtures, asserts, and rolls everything back at the end.
--   3. Expect nine PASS notices and no exception. Any FAIL means the
--      deployment is misconfigured -- stop and fix it before going live.
--
-- WHY FIXTURES
--   An UPDATE or DELETE that matches zero rows is indistinguishable from one
--   that RLS blocked. On an empty database every "cannot modify" assertion
--   would pass vacuously -- a green gate proving nothing. Every assertion here
--   acts on a known fixture row, and assertion 0 proves those rows exist.
--
-- WHY COUNTS RATHER THAN EXCEPTIONS
--   For SELECT and UPDATE, RLS denies by returning or affecting zero rows; it
--   does not raise. Only INSERT raises (insufficient_privilege), because the
--   WITH CHECK clause is violated. The assertions below match those semantics.

begin;

create temp table _v (staff_uuid uuid, owner_uuid uuid) on commit drop;
insert into _v values ('<staff-uuid>', '<owner-uuid>');

-- Fixtures. This runs as the table owner, which bypasses RLS by design.
insert into public.menu_items (id, name, category, price, is_available)
values ('dddddddd-0000-0000-0000-000000000001', '__verify_item', 'Lunch', 100, true);

insert into public.orders (id, order_type, total_amount, payment_mode)
values ('dddddddd-0000-0000-0000-000000000002', 'counter', 100, 'cash');

insert into public.order_items (order_id, menu_item_id, item_name, unit_price, quantity)
values ('dddddddd-0000-0000-0000-000000000002',
        'dddddddd-0000-0000-0000-000000000001', '__verify_item', 100, 1);

-- ============ 0. anti-vacuity guard ============

do $$
declare o int; m int; i int;
begin
  select count(*) into o from public.orders
    where id = 'dddddddd-0000-0000-0000-000000000002';
  select count(*) into m from public.menu_items
    where id = 'dddddddd-0000-0000-0000-000000000001';
  select count(*) into i from public.order_items
    where order_id = 'dddddddd-0000-0000-0000-000000000002';
  if o <> 1 or m <> 1 or i <> 1 then
    raise exception
      'FAIL: fixtures missing (orders=%, menu_items=%, order_items=%) - every assertion below would pass vacuously',
      o, m, i;
  end if;
  raise notice 'PASS: fixtures present, assertions are meaningful';
end $$;

-- ============ must be REJECTED ============

-- 1. anonymous cannot read orders
do $$
declare n int;
begin
  set local role anon;
  select count(*) into n from public.orders;
  reset role;
  if n <> 0 then
    raise exception 'FAIL: anon read % order row(s), expected 0', n;
  end if;
  raise notice 'PASS: anon cannot read orders';
end $$;

-- 2. anonymous cannot read order_items
do $$
declare n int;
begin
  set local role anon;
  select count(*) into n from public.order_items;
  reset role;
  if n <> 0 then
    raise exception 'FAIL: anon read % order_item row(s), expected 0', n;
  end if;
  raise notice 'PASS: anon cannot read order_items';
end $$;

-- 3. staff cannot change an order amount
do $$
declare n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select staff_uuid from _v),
                      'role', 'authenticated')::text, true);
  update public.orders set total_amount = 1
   where id = 'dddddddd-0000-0000-0000-000000000002';
  get diagnostics n = row_count;
  reset role;
  if n <> 0 then
    raise exception 'FAIL: staff updated % order row(s)', n;
  end if;
  raise notice 'PASS: staff cannot update order amounts';
end $$;

-- 4. staff cannot change a price
do $$
declare n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select staff_uuid from _v),
                      'role', 'authenticated')::text, true);
  update public.menu_items set price = 1
   where id = 'dddddddd-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  reset role;
  if n <> 0 then
    raise exception 'FAIL: staff updated % menu price(s)', n;
  end if;
  raise notice 'PASS: staff cannot update prices';
end $$;

-- 5. staff cannot add a menu item
--    INSERT is the one case that raises: the WITH CHECK clause is violated.
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select staff_uuid from _v),
                      'role', 'authenticated')::text, true);
  begin
    insert into public.menu_items (name, category, price)
    values ('__verify_hack', 'Lunch', 1);
    reset role;
    raise exception 'FAIL: staff inserted a menu item';
  exception
    when insufficient_privilege then
      reset role;
      raise notice 'PASS: staff cannot insert menu items';
  end;
end $$;

-- 6. nobody can delete an order
do $$
declare n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select staff_uuid from _v),
                      'role', 'authenticated')::text, true);
  delete from public.orders
   where id = 'dddddddd-0000-0000-0000-000000000002';
  get diagnostics n = row_count;
  reset role;
  if n <> 0 then
    raise exception 'FAIL: % order row(s) were deleted', n;
  end if;
  raise notice 'PASS: orders cannot be deleted';
end $$;

-- ============ must SUCCEED ============

-- 7. anonymous can read the menu
do $$
declare n int;
begin
  set local role anon;
  select count(*) into n from public.menu_items;
  reset role;
  if n < 1 then
    raise exception 'FAIL: anon cannot read the menu (saw % rows)', n;
  end if;
  raise notice 'PASS: anon read % menu item(s)', n;
end $$;

-- 8. the owner CAN change an order amount.
--    Positive control: without this, a deny-everyone misconfiguration would
--    pass assertions 1-6 while leaving the app unusable.
do $$
declare n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select owner_uuid from _v),
                      'role', 'authenticated')::text, true);
  update public.orders set total_amount = 101
   where id = 'dddddddd-0000-0000-0000-000000000002';
  get diagnostics n = row_count;
  reset role;
  if n <> 1 then
    raise exception
      'FAIL: owner updated % order row(s), expected 1 - check the profiles row for the owner UUID', n;
  end if;
  raise notice 'PASS: owner can update order amounts';
end $$;

rollback;
```

- [ ] **Step 4: Run the gate**

Run `sql/verify_rls.sql` in the SQL editor.

Expected: nine `PASS:` notices and no exception. **Any `FAIL:` means stop and fix the policies before continuing** — every later task assumes this gate is green.

- [ ] **Step 5: Commit**

```bash
git add sql/policies.sql sql/verify_rls.sql
git commit -m "feat: add RLS policies and security verification script"
```

---

### Task 4: Seed the menu

**Files:**
- Create: `sql/seed.sql`

**Interfaces:**
- Consumes: `menu_items` from Task 1
- Produces: rows the order-entry list and public menu render

Prices below are placeholders drawn from the categories on the live site. **Confirm real prices with the owner before running**; they are trivial to edit afterwards in the admin Menu tab.

- [ ] **Step 1: Write `sql/seed.sql`**

```sql
-- Starting menu. Edit prices to match the shop before running.
insert into public.menu_items (name, category, price, display_order) values
  ('Millet Dosa',        'Breakfast', 80,  10),
  ('Millet Idli',        'Breakfast', 60,  20),
  ('Egg Bhurji',         'Breakfast', 70,  30),
  ('Boiled Eggs',        'Breakfast', 30,  40),
  ('Millet Bowl',        'Lunch',    180,  10),
  ('Millet Meals',       'Lunch',    150,  20),
  ('Protein Shake',      'Drinks',   120,  10),
  ('Fresh Juice',        'Drinks',    80,  20),
  ('Buttermilk',         'Drinks',    30,  30),
  ('Millet Snack Pack',  'Shelf',    150,  10),
  ('Ready Mix',          'Shelf',    250,  20);
```

- [ ] **Step 2: Run it and verify**

```sql
select category, count(*), min(price), max(price)
from public.menu_items group by category order by category;
```

Expected: four rows — Breakfast 4, Drinks 3, Lunch 2, Shelf 2.

- [ ] **Step 3: Commit**

```bash
git add sql/seed.sql
git commit -m "feat: add starting menu seed data"
```

---

### Task 5: Pure logic modules and their tests

**Files:**
- Create: `js/lib/date.js`, `js/lib/money.js`, `js/lib/bill.js`, `js/lib/summary.js`, `js/lib/csv.js`
- Test: `tests/date.test.js`, `tests/bill.test.js`, `tests/summary.test.js`, `tests/csv.test.js`
- Note: `js/lib/html.js` and `tests/html.test.js` were added during Task 7; they follow the same purity rule as the modules here.

**Interfaces:**
- Consumes: nothing — these modules import nothing and touch no DOM
- Produces:
  - `istBusinessDate(now?: Date): string` — `YYYY-MM-DD`
  - `formatINR(n: number): string`
  - `addLine(lines, item)`, `changeQty(lines, id, delta)`, `removeLine(lines, id)`, `billTotal(lines)` where a line is `{menu_item_id, name, price, quantity}`
  - `summarise(orders): {count, revenue, cash, upi}`
  - `topItems(items, n): [{name, quantity}]`
  - `toCsv(rows, columns): string`

- [ ] **Step 1: Write the failing tests**

`tests/date.test.js` — the IST boundary is the highest-value test in this codebase:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { istBusinessDate } from '../js/lib/date.js';

test('daytime UTC maps to the same IST date', () => {
  assert.equal(istBusinessDate(new Date('2026-08-10T06:00:00Z')), '2026-08-10');
});

test('late IST evening is still the same business day', () => {
  // 20:30 IST on the 10th
  assert.equal(istBusinessDate(new Date('2026-08-10T15:00:00Z')), '2026-08-10');
});

test('after midnight IST rolls to the next business day', () => {
  // 00:30 IST on the 11th
  assert.equal(istBusinessDate(new Date('2026-08-10T19:00:00Z')), '2026-08-11');
});

test('exactly 18:30 UTC is the IST midnight boundary', () => {
  assert.equal(istBusinessDate(new Date('2026-08-10T18:30:00Z')), '2026-08-11');
  assert.equal(istBusinessDate(new Date('2026-08-10T18:29:59Z')), '2026-08-10');
});
```

`tests/bill.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addLine, changeQty, removeLine, billTotal } from '../js/lib/bill.js';

const dosa  = { id: 'a', name: 'Millet Dosa', price: 80 };
const shake = { id: 'b', name: 'Protein Shake', price: 120 };

test('adding an item creates a line with quantity 1', () => {
  const lines = addLine([], dosa);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].quantity, 1);
  assert.equal(lines[0].menu_item_id, 'a');
});

test('adding the same item again increments quantity, not lines', () => {
  const lines = addLine(addLine([], dosa), dosa);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].quantity, 2);
});

test('changeQty removes the line when it reaches zero', () => {
  const lines = changeQty(addLine([], dosa), 'a', -1);
  assert.equal(lines.length, 0);
});

test('billTotal multiplies price by quantity across lines', () => {
  let lines = addLine([], dosa);
  lines = addLine(lines, dosa);
  lines = addLine(lines, shake);
  assert.equal(billTotal(lines), 280);
});

test('removeLine drops only the named line', () => {
  const lines = removeLine(addLine(addLine([], dosa), shake), 'a');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].menu_item_id, 'b');
});

test('input array is never mutated', () => {
  const original = addLine([], dosa);
  addLine(original, shake);
  assert.equal(original.length, 1);
});
```

`tests/summary.test.js` — invalid orders must vanish from every figure:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarise, topItems } from '../js/lib/summary.js';

const orders = [
  { total_amount: 100, payment_mode: 'cash', status: 'valid' },
  { total_amount: 250, payment_mode: 'upi',  status: 'valid' },
  { total_amount: 999, payment_mode: 'upi',  status: 'invalid' },
];

test('summarise counts only valid orders', () => {
  assert.deepEqual(summarise(orders), { count: 2, revenue: 350, cash: 100, upi: 250 });
});

test('summarise handles an empty day', () => {
  assert.deepEqual(summarise([]), { count: 0, revenue: 0, cash: 0, upi: 0 });
});

test('topItems sums duplicate names, ranks by quantity, respects the limit', () => {
  const items = [
    { item_name: 'Dosa',  quantity: 3 },
    { item_name: 'Shake', quantity: 4 },
    { item_name: 'Idli',  quantity: 1 },
    { item_name: 'Dosa',  quantity: 2 },
  ];
  // Dosa totals 5, Shake 4, Idli 1. Limit of 2 drops Idli.
  assert.deepEqual(topItems(items, 2), [
    { name: 'Dosa',  quantity: 5 },
    { name: 'Shake', quantity: 4 },
  ]);
});

test('topItems breaks quantity ties alphabetically', () => {
  const items = [
    { item_name: 'Shake', quantity: 2 },
    { item_name: 'Dosa',  quantity: 2 },
  ];
  assert.deepEqual(topItems(items, 2), [
    { name: 'Dosa',  quantity: 2 },
    { name: 'Shake', quantity: 2 },
  ]);
});
```

`tests/csv.test.js` — item names can contain commas:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCsv } from '../js/lib/csv.js';

test('writes a header row and values in column order', () => {
  const csv = toCsv([{ a: 1, b: 2 }], ['a', 'b']);
  assert.equal(csv, 'a,b\r\n1,2');
});

test('quotes values containing commas', () => {
  const csv = toCsv([{ name: 'Dosa, Idli' }], ['name']);
  assert.equal(csv, 'name\r\n"Dosa, Idli"');
});

test('escapes embedded double quotes by doubling them', () => {
  const csv = toCsv([{ name: 'Ragi "special"' }], ['name']);
  assert.equal(csv, 'name\r\n"Ragi ""special"""');
});

test('renders null and undefined as empty cells', () => {
  const csv = toCsv([{ a: null, b: undefined }], ['a', 'b']);
  assert.equal(csv, 'a,b\r\n,');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../js/lib/date.js'` for each suite.

- [ ] **Step 3: Write the implementations**

`js/lib/date.js`:

```js
// IST is UTC+5:30 year round — India observes no daylight saving.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Business date in IST as YYYY-MM-DD. */
export function istBusinessDate(now = new Date()) {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}
```

`js/lib/money.js`:

```js
/** Format a number as Indian rupees, e.g. 4850 -> "₹4,850". */
export function formatINR(n) {
  return '₹' + Number(n || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}
```

`js/lib/bill.js`:

```js
// A line is { menu_item_id, name, price, quantity }.
// Every function returns a new array; none mutate their input.

export function addLine(lines, item) {
  const existing = lines.find((l) => l.menu_item_id === item.id);
  if (existing) return changeQty(lines, item.id, 1);
  return [...lines, {
    menu_item_id: item.id,
    name: item.name,
    price: Number(item.price),
    quantity: 1,
  }];
}

export function changeQty(lines, id, delta) {
  return lines
    .map((l) => (l.menu_item_id === id ? { ...l, quantity: l.quantity + delta } : l))
    .filter((l) => l.quantity > 0);
}

export function removeLine(lines, id) {
  return lines.filter((l) => l.menu_item_id !== id);
}

export function billTotal(lines) {
  return lines.reduce((sum, l) => sum + l.price * l.quantity, 0);
}
```

`js/lib/summary.js`:

```js
/** Daily totals. Invalid orders are excluded from every figure. */
export function summarise(orders) {
  return orders
    .filter((o) => o.status === 'valid')
    .reduce((acc, o) => {
      const amount = Number(o.total_amount);
      acc.count += 1;
      acc.revenue += amount;
      if (o.payment_mode === 'cash') acc.cash += amount;
      else acc.upi += amount;
      return acc;
    }, { count: 0, revenue: 0, cash: 0, upi: 0 });
}

/** Best sellers by quantity. Caller passes lines of valid orders only. */
export function topItems(items, n = 3) {
  const totals = new Map();
  for (const it of items) {
    totals.set(it.item_name, (totals.get(it.item_name) || 0) + Number(it.quantity));
  }
  return [...totals.entries()]
    .map(([name, quantity]) => ({ name, quantity }))
    .sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name))
    .slice(0, n);
}
```

`js/lib/csv.js`:

```js
function cell(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
}

/** Serialise rows to CSV. Uses CRLF, which is what Excel expects. */
export function toCsv(rows, columns) {
  const header = columns.map(cell).join(',');
  const body = rows.map((r) => columns.map((c) => cell(r[c])).join(','));
  return [header, ...body].join('\r\n');
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — 18 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add package.json js/lib tests
git commit -m "feat: add pure logic modules for dates, bills, summaries and CSV"
```

---

### Task 6: Supabase client, auth and the admin shell

**Files:**
- Create: `js/config.js`, `js/supabase.js`, `js/auth.js`, `css/app.css`, `admin.html`

**Interfaces:**
- Consumes: `profiles` and the accounts from Task 3
- Produces:
  - `supabase` — the client singleton
  - `signIn(email, password)`, `signOut()`, `getSession()`, `getRole()`
  - `admin.html` with `#login-view`, `#app-view`, `#tab-orders`, `#tab-menu`, `#role-badge`

- [ ] **Step 1: Write the config and client**

`js/config.js` — the anon key is public by design and safe to commit. Replace both values with those from Supabase → Settings → API.

```js
export const SUPABASE_URL = 'https://<project-ref>.supabase.co';
export const SUPABASE_ANON_KEY = '<anon-key>';
```

`js/supabase.js`:

```js
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});
```

`js/auth.js`:

```js
import { supabase } from './supabase.js';

export async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/** 'owner' | 'staff' | null. The UI uses this to hide controls; the
 *  database enforces the same rules independently. */
export async function getRole() {
  const session = await getSession();
  if (!session) return null;
  const { data, error } = await supabase
    .from('profiles').select('role').eq('id', session.user.id).single();
  if (error) return null;
  return data.role;
}
```

- [ ] **Step 2: Write `css/app.css`**

Tokens are copied from `index.html` rather than shared, because `index.html` must not be modified.

```css
:root{
  --green-900:#123f21; --green-700:#17552C; --green-500:#2E8B4E;
  --gold:#F2C14E; --tint:#E7F0E4;
  --cream:#F7F4EA; --ink:#20301F; --muted:#6E7A63;
  --danger:#B23B3B;
  --sans:'Poppins',system-ui,sans-serif;
  --display:Georgia,serif;
}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--sans);background:var(--cream);color:var(--ink);line-height:1.5}
.wrap{max-width:720px;margin:0 auto;padding:16px}
.hidden{display:none!important}
h1,h2,h3{font-family:var(--display);color:var(--green-900);font-weight:700}
button{font-family:inherit;font-size:1rem;cursor:pointer;border:0;border-radius:12px;padding:14px 18px}
.btn-primary{background:var(--green-700);color:#fff;width:100%}
.btn-gold{background:var(--gold);color:var(--ink)}
.btn-ghost{background:#fff;border:1.5px solid #dcd6c6;color:var(--ink)}
.btn-danger{background:#fff;border:1.5px solid var(--danger);color:var(--danger);padding:8px 12px;font-size:.85rem}
input,select{width:100%;font-family:inherit;font-size:1rem;padding:13px 14px;
  border:1.5px solid #dcd6c6;border-radius:12px;background:#fff}
label{display:block;font-weight:600;font-size:.85rem;margin:12px 0 6px}
.card{background:#fff;border:1px solid #ece5d4;border-radius:16px;padding:16px;margin-bottom:14px}
.tabs{display:flex;gap:8px;margin-bottom:16px}
.tabs button{flex:1;background:#fff;border:1.5px solid #dcd6c6}
.tabs button[aria-selected="true"]{background:var(--green-700);color:#fff;border-color:var(--green-700)}
.row{display:flex;justify-content:space-between;align-items:center;gap:10px;
  padding:10px 0;border-bottom:1px solid #f0ead9}
.row:last-child{border-bottom:0}
.muted{color:var(--muted);font-size:.85rem}
.invalid{opacity:.55;text-decoration:line-through}
.err{color:var(--danger);font-size:.9rem;margin-top:10px}
.topbar{display:flex;justify-content:space-between;align-items:center;padding:12px 0}
.badge{background:var(--tint);color:var(--green-700);font-size:.75rem;font-weight:700;
  text-transform:uppercase;padding:5px 10px;border-radius:999px}
```

- [ ] **Step 3: Write `admin.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<title>Amrithaha Admin</title>
<link rel="icon" href="Logos/amrithaha_icon_light.svg" type="image/svg+xml">
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="css/app.css">
</head>
<body>

<div class="wrap">

  <section id="login-view">
    <h1>Amrithaha</h1>
    <p class="muted">Sign in to log sales.</p>
    <div class="card" style="margin-top:16px">
      <label for="email">Email</label>
      <input id="email" type="email" autocomplete="username">
      <label for="password">Password</label>
      <input id="password" type="password" autocomplete="current-password">
      <div style="margin-top:16px"><button class="btn-primary" id="login-btn">Sign in</button></div>
      <p class="err hidden" id="login-error"></p>
    </div>
  </section>

  <section id="app-view" class="hidden">
    <div class="topbar">
      <h2>Amrithaha</h2>
      <div>
        <span class="badge" id="role-badge"></span>
        <button class="btn-ghost" id="logout-btn" style="padding:8px 12px;font-size:.85rem">Sign out</button>
      </div>
    </div>

    <div class="tabs" role="tablist">
      <button id="tab-orders-btn" role="tab" aria-selected="true">Orders</button>
      <button id="tab-menu-btn"   role="tab" aria-selected="false">Menu</button>
    </div>

    <div id="tab-orders"></div>
    <div id="tab-menu" class="hidden"></div>
  </section>

</div>

<script type="module" src="js/admin.js"></script>
</body>
</html>
```

- [ ] **Step 4: Write the shell wiring in `js/admin.js`**

Later tasks extend this file; this step establishes login, role and tabs only.

```js
import { signIn, signOut, getSession, getRole } from './auth.js';

const $ = (id) => document.getElementById(id);
export const state = { role: null };

async function render() {
  const session = await getSession();
  if (!session) {
    $('login-view').classList.remove('hidden');
    $('app-view').classList.add('hidden');
    return;
  }
  state.role = await getRole();
  $('login-view').classList.add('hidden');
  $('app-view').classList.remove('hidden');
  $('role-badge').textContent = state.role || 'unknown';
  document.dispatchEvent(new CustomEvent('admin:ready'));
}

$('login-btn').addEventListener('click', async () => {
  const err = $('login-error');
  err.classList.add('hidden');
  $('login-btn').disabled = true;
  try {
    await signIn($('email').value.trim(), $('password').value);
    await render();
  } catch (e) {
    err.textContent = e.message || 'Could not sign in.';
    err.classList.remove('hidden');
  } finally {
    $('login-btn').disabled = false;
  }
});

$('logout-btn').addEventListener('click', async () => {
  await signOut();
  location.reload();
});

function selectTab(name) {
  const isOrders = name === 'orders';
  $('tab-orders-btn').setAttribute('aria-selected', String(isOrders));
  $('tab-menu-btn').setAttribute('aria-selected', String(!isOrders));
  $('tab-orders').classList.toggle('hidden', !isOrders);
  $('tab-menu').classList.toggle('hidden', isOrders);
}
$('tab-orders-btn').addEventListener('click', () => selectTab('orders'));
$('tab-menu-btn').addEventListener('click', () => selectTab('menu'));

render();
```

- [ ] **Step 5: Verify login and role manually**

Serve locally — ES modules will not load over `file://`:

```bash
npx serve . -l 5000
```

Open `http://localhost:5000/admin.html` and check:

1. Login form appears.
2. Wrong password shows a red error, no crash.
3. Owner credentials sign in; badge reads `owner`.
4. Reloading the page stays signed in (session persists).
5. Sign out returns to the login form.
6. Staff credentials sign in; badge reads `staff`.

- [ ] **Step 6: Commit**

```bash
git add js/config.js js/supabase.js js/auth.js js/admin.js css/app.css admin.html
git commit -m "feat: add admin shell with Supabase auth and role badge"
```

---

### Task 7: Order entry — counter and catering

**Files:**
- Create: `js/db.js`
- Modify: `js/admin.js` (append)

**Interfaces:**
- Consumes: `supabase`, `js/lib/bill.js`, `js/lib/money.js`
- Produces:
  - `db.listMenuItems()`, `db.createCounterOrder(paymentMode, lines)`, `db.createCateringOrder(fields)`
  - Orders tab renders into `#tab-orders`

- [ ] **Step 1: Write `js/db.js`**

```js
import { supabase } from './supabase.js';
import { istBusinessDate } from './lib/date.js';

export async function listMenuItems() {
  const { data, error } = await supabase
    .from('menu_items').select('*')
    .order('category').order('display_order').order('name');
  if (error) throw error;
  return data;
}

export async function createCounterOrder(paymentMode, lines) {
  const items = lines.map((l) => ({ menu_item_id: l.menu_item_id, quantity: l.quantity }));
  const { data, error } = await supabase.rpc('create_counter_order', {
    p_payment_mode: paymentMode,
    p_items: items,
  });
  if (error) throw error;
  return data;
}

export async function createCateringOrder(f) {
  const { data, error } = await supabase.rpc('create_catering_order', {
    p_description: f.description,
    p_amount: f.amount,
    p_payment_mode: f.paymentMode,
    p_customer_name: f.customerName || null,
    p_customer_phone: f.customerPhone || null,
  });
  if (error) throw error;
  return data;
}

export async function listTodayOrders() {
  const { data, error } = await supabase
    .from('orders').select('*')
    .eq('business_date', istBusinessDate())
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function listTodayOrderItems() {
  const { data, error } = await supabase
    .from('order_items')
    .select('item_name, quantity, order_id, orders!inner(business_date, status)')
    .eq('orders.business_date', istBusinessDate())
    .eq('orders.status', 'valid');
  if (error) throw error;
  return data;
}

export async function orderLines(orderId) {
  const { data, error } = await supabase
    .from('order_items').select('*').eq('order_id', orderId);
  if (error) throw error;
  return data;
}

export async function markInvalid(orderId) {
  const { error } = await supabase.rpc('mark_order_invalid', { p_order_id: orderId });
  if (error) throw error;
}

export async function setAvailability(itemId, available) {
  const { error } = await supabase.rpc('set_item_availability', {
    p_item_id: itemId, p_available: available,
  });
  if (error) throw error;
}
```

- [ ] **Step 2: Append the order-entry UI to `js/admin.js`**

```js
import * as db from './db.js';
import { addLine, changeQty, removeLine, billTotal } from './lib/bill.js';
import { formatINR } from './lib/money.js';
import { escapeHtml } from './lib/html.js';
import { parseAmount } from './lib/amount.js';

let menuItems = [];
let lines = [];
let orderType = 'counter';
let paymentMode = 'cash';

function entryHtml() {
  return `
    <div class="card">
      <div class="tabs">
        <button id="type-counter"  aria-selected="${orderType === 'counter'}">Counter</button>
        <button id="type-catering" aria-selected="${orderType === 'catering'}">Catering</button>
      </div>

      <div id="counter-form" class="${orderType === 'counter' ? '' : 'hidden'}">
        <div id="item-buttons"></div>
        <div id="bill-lines" style="margin-top:12px"></div>
      </div>

      <div id="catering-form" class="${orderType === 'catering' ? '' : 'hidden'}">
        <label for="cat-desc">What is it for</label>
        <input id="cat-desc" placeholder="e.g. Office lunch, 20 boxes">
        <label for="cat-amount">Amount</label>
        <input id="cat-amount" type="number" inputmode="decimal" min="0">
        <label for="cat-name">Customer name (optional)</label>
        <input id="cat-name">
        <label for="cat-phone">Phone (optional)</label>
        <input id="cat-phone" type="tel">
      </div>

      <label>Payment</label>
      <div class="tabs">
        <button id="pay-cash" aria-selected="${paymentMode === 'cash'}">Cash</button>
        <button id="pay-upi"  aria-selected="${paymentMode === 'upi'}">UPI</button>
      </div>

      <button class="btn-primary" id="save-order">Save order</button>
      <p class="err hidden" id="order-error"></p>
    </div>`;
}

function renderItemButtons() {
  const available = menuItems.filter((i) => i.is_available);
  const categories = [...new Set(available.map((i) => i.category))];
  document.getElementById('item-buttons').innerHTML = categories.map((cat) => `
    <div style="margin-bottom:10px">
      <div class="muted" style="font-weight:600;margin-bottom:6px">${escapeHtml(cat)}</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        ${available.filter((i) => i.category === cat).map((i) => `
          <button class="btn-ghost add-item" data-id="${i.id}"
                  style="padding:10px 14px;font-size:.9rem">
            ${escapeHtml(i.name)} <span class="muted">${formatINR(i.price)}</span>
          </button>`).join('')}
      </div>
    </div>`).join('');

  document.querySelectorAll('.add-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = menuItems.find((i) => i.id === btn.dataset.id);
      lines = addLine(lines, item);
      renderBill();
    });
  });
}

function renderBill() {
  const el = document.getElementById('bill-lines');
  if (!lines.length) { el.innerHTML = '<p class="muted">No items yet.</p>'; return; }
  el.innerHTML = lines.map((l) => `
    <div class="row">
      <span>${escapeHtml(l.name)}<br><span class="muted">${formatINR(l.price)}</span></span>
      <span style="display:flex;align-items:center;gap:10px">
        <button class="btn-ghost qty" data-id="${l.menu_item_id}" data-d="-1" style="padding:6px 12px">-</button>
        <strong>${l.quantity}</strong>
        <button class="btn-ghost qty" data-id="${l.menu_item_id}" data-d="1" style="padding:6px 12px">+</button>
        <button class="btn-danger drop" data-id="${l.menu_item_id}">Remove</button>
      </span>
    </div>`).join('')
    + `<div class="row"><strong>Total</strong><strong>${formatINR(billTotal(lines))}</strong></div>`;

  el.querySelectorAll('.qty').forEach((b) => b.addEventListener('click', () => {
    lines = changeQty(lines, b.dataset.id, Number(b.dataset.d));
    renderBill();
  }));
  el.querySelectorAll('.drop').forEach((b) => b.addEventListener('click', () => {
    lines = removeLine(lines, b.dataset.id);
    renderBill();
  }));
}

function wireEntry() {
  const setType = (t) => { orderType = t; renderOrdersTab(); };
  document.getElementById('type-counter').onclick  = () => setType('counter');
  document.getElementById('type-catering').onclick = () => setType('catering');

  const setPay = (p) => {
    paymentMode = p;
    document.getElementById('pay-cash').setAttribute('aria-selected', String(p === 'cash'));
    document.getElementById('pay-upi').setAttribute('aria-selected',  String(p === 'upi'));
  };
  document.getElementById('pay-cash').onclick = () => setPay('cash');
  document.getElementById('pay-upi').onclick  = () => setPay('upi');

  document.getElementById('save-order').onclick = saveOrder;
}

async function saveOrder() {
  const btn = document.getElementById('save-order');
  const err = document.getElementById('order-error');
  err.classList.add('hidden');
  btn.disabled = true;
  btn.textContent = 'Saving...';
  try {
    if (orderType === 'counter') {
      if (!lines.length) throw new Error('Add at least one item.');
      await db.createCounterOrder(paymentMode, lines);
      lines = [];
    } else {
      const description = document.getElementById('cat-desc').value.trim();
      const amount = parseAmount(document.getElementById('cat-amount').value);
      if (!description) throw new Error('Describe the catering order.');
      if (amount === null) throw new Error('Enter a valid catering amount.');
      await db.createCateringOrder({
        description, amount, paymentMode,
        customerName:  document.getElementById('cat-name').value.trim(),
        customerPhone: document.getElementById('cat-phone').value.trim(),
      });
    }
    await renderOrdersTab();
  } catch (e) {
    // The bill stays on screen so nothing is lost; the user can retry.
    err.textContent = (e.message || 'Could not save.') + ' Your order is still here — try again.';
    err.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save order';
  }
}

export async function renderOrdersTab() {
  document.getElementById('tab-orders').innerHTML = entryHtml();
  wireEntry();
  if (orderType === 'counter') { renderItemButtons(); renderBill(); }
}

document.addEventListener('admin:ready', async () => {
  menuItems = await db.listMenuItems();
  await renderOrdersTab();
});
```

- [ ] **Step 3: Verify order entry manually**

With `npx serve . -l 5000`, signed in as **staff**:

1. Item buttons appear grouped by category, prices shown.
2. Tapping "Millet Dosa" twice shows one line with quantity 2.
3. `-` reduces to 1; `-` again removes the line.
4. Total matches the arithmetic.
5. Select UPI, tap Save. The bill clears.
6. Confirm in the SQL editor:

```sql
select o.total_amount, o.payment_mode, o.business_date,
       i.item_name, i.unit_price, i.quantity, i.line_total
from orders o join order_items i on i.order_id = o.id
order by o.created_at desc limit 5;
```

Expected: `unit_price` matches the menu, `line_total` = price × quantity, `total_amount` = sum of lines, `business_date` is today in IST.

7. Switch to Catering, save a ₹2000 order with a description. Confirm it lands with `order_type = 'catering'` and no `order_items` rows.

- [ ] **Step 4: Verify the price cannot be forged**

In the browser console while signed in:

```js
const { data, error } = await (await import('./js/supabase.js')).supabase
  .rpc('create_counter_order', { p_payment_mode: 'cash',
    p_items: [{ menu_item_id: '<a-real-item-uuid>', quantity: 1, price: 1 }] });
console.log(data, error);
```

Expected: the order is created at the **menu price**, not ₹1 — the extra `price` field is ignored because the function reads prices from the database.

- [ ] **Step 5: Commit**

```bash
git add js/db.js js/admin.js
git commit -m "feat: add counter and catering order entry"
```

---

### Task 8: Daily dashboard, today's list, undo and invalidate

**Files:**
- Modify: `js/admin.js` (append)

**Interfaces:**
- Consumes: `db.listTodayOrders`, `db.listTodayOrderItems`, `db.orderLines`, `db.markInvalid`, `summarise`, `topItems`
- Produces: `renderToday()`, called after every save

- [ ] **Step 1: Append the dashboard and list to `js/admin.js`**

```js
import { summarise, topItems } from './lib/summary.js';

let lastOrderId = null;

async function renderToday() {
  const [orders, items] = await Promise.all([
    db.listTodayOrders(), db.listTodayOrderItems(),
  ]);
  const s = summarise(orders);
  const top = topItems(items, 3);
  const itemsSold = items.reduce((n, i) => n + Number(i.quantity), 0);

  document.getElementById('today').innerHTML = `
    <div class="card">
      <h3>Today</h3>
      <div class="row"><span>Orders</span><strong>${s.count}</strong></div>
      <div class="row"><span>Revenue</span><strong>${formatINR(s.revenue)}</strong></div>
      <div class="row"><span>UPI</span><span>${formatINR(s.upi)}</span></div>
      <div class="row"><span>Cash</span><span>${formatINR(s.cash)}</span></div>
      <div class="row"><span>Items sold</span><span>${itemsSold}</span></div>
      <div class="row"><span>Top items</span><span class="muted">${
        top.length ? top.map((t) => `${escapeHtml(t.name)} (${t.quantity})`).join(', ') : '—'
      }</span></div>
    </div>

    <div class="card">
      <h3>Today's orders</h3>
      ${orders.length ? orders.map((o) => `
        <div class="row ${o.status === 'invalid' ? 'invalid' : ''}">
          <span>
            ${o.order_type === 'catering' ? `Catering — ${escapeHtml(o.description)}` : 'Counter'}
            <br><span class="muted">${new Date(o.created_at).toLocaleTimeString('en-IN',
              { hour: '2-digit', minute: '2-digit' })} · ${escapeHtml(o.payment_mode).toUpperCase()}</span>
          </span>
          <span style="display:flex;align-items:center;gap:10px">
            <strong>${formatINR(o.total_amount)}</strong>
            ${o.status === 'valid'
              ? `<button class="btn-danger invalidate" data-id="${o.id}">${
                   o.id === lastOrderId ? 'Undo' : 'Mark invalid'}</button>`
              : '<span class="muted">invalid</span>'}
          </span>
        </div>`).join('') : '<p class="muted">No orders yet today.</p>'}
    </div>`;

  document.querySelectorAll('.invalidate').forEach((b) => {
    b.addEventListener('click', () => invalidate(b.dataset.id));
  });
}

/** Undo and Mark invalid are the same operation. Undo additionally reloads
 *  the order's lines into the entry form so the correction is one tap away.
 *  Nothing is ever deleted. */
async function invalidate(orderId) {
  const isUndo = orderId === lastOrderId;
  const reload = isUndo ? await db.orderLines(orderId) : [];
  await db.markInvalid(orderId);
  if (isUndo && reload.length) {
    orderType = 'counter';
    lines = reload.map((r) => ({
      menu_item_id: r.menu_item_id,
      name: r.item_name,
      price: Number(r.unit_price),
      quantity: r.quantity,
    }));
    lastOrderId = null;
    await renderOrdersTab();
    return;
  }
  // Only clear when the undone order WAS the newest one. Marking an older
  // order invalid must not strip the Undo affordance from the latest sale.
  if (isUndo) lastOrderId = null;
  await renderToday();
}
```

- [ ] **Step 2: Add the `#today` container and call it after saves**

In `entryHtml()`, append `<div id="today"></div>` after the closing `</div>` of the entry card. In `renderOrdersTab()`, add `await renderToday();` as the final line. In `saveOrder()`, set `lastOrderId` from the returned id:

```js
      const id = await db.createCounterOrder(paymentMode, lines);
      lastOrderId = id;
      lines = [];
```

and for the catering branch:

```js
      lastOrderId = await db.createCateringOrder({ ... });
```

- [ ] **Step 3: Verify the dashboard manually**

1. Save two counter orders (one cash, one UPI) and one catering order.
2. Revenue equals the sum of all three; UPI and cash split correctly; items sold counts only counter lines.
3. The most recent order's button reads **Undo**; older ones read **Mark invalid**.
4. Tap **Undo** on a counter order — it goes struck-through, revenue drops by that amount, and its items reappear in the entry form with the right quantities.
5. Tap **Mark invalid** on an older order — struck through, revenue drops, top items and items-sold both drop too.
6. Reload the page; invalid orders are still visible and still excluded.

- [ ] **Step 4: Verify staff cannot bypass invalidation**

Signed in as **staff**, in the browser console:

```js
const { error } = await (await import('./js/supabase.js')).supabase
  .from('orders').update({ total_amount: 1 }).neq('id', '00000000-0000-0000-0000-000000000000');
console.log(error);
```

Expected: zero rows affected — the `orders_owner_update` policy filters them out. Confirm no amount changed in the SQL editor.

- [ ] **Step 5: Commit**

```bash
git add js/admin.js
git commit -m "feat: add daily dashboard, order list, undo and invalidate"
```

---

### Task 9: Menu tab

**Files:**
- Modify: `js/admin.js` (append)

**Interfaces:**
- Consumes: `db.listMenuItems`, `db.setAvailability`, `state.role`
- Produces: `renderMenuTab()`

- [ ] **Step 1: Append the menu tab to `js/admin.js`**

```js
async function renderMenuTab() {
  menuItems = await db.listMenuItems();
  const isOwner = state.role === 'owner';
  const categories = [...new Set(menuItems.map((i) => i.category))];

  document.getElementById('tab-menu').innerHTML = `
    ${isOwner ? `
      <div class="card">
        <h3>Add item</h3>
        <label for="mi-name">Name</label><input id="mi-name">
        <label for="mi-cat">Category</label>
        <select id="mi-cat">
          <option>Breakfast</option><option>Lunch</option>
          <option>Drinks</option><option>Shelf</option>
        </select>
        <label for="mi-price">Price</label>
        <input id="mi-price" type="number" inputmode="decimal" min="0">
        <div style="margin-top:14px"><button class="btn-primary" id="mi-save">Add item</button></div>
        <p class="err hidden" id="mi-error"></p>
      </div>` : ''}

    <div class="card">
      <h3>Menu</h3>
      <p class="muted">${isOwner
        ? 'Toggle availability, or edit price and name.'
        : 'You can mark items available or sold out.'}</p>
      ${categories.map((cat) => `
        <div style="margin-top:14px">
          <div class="muted" style="font-weight:600">${escapeHtml(cat)}</div>
          ${menuItems.filter((i) => i.category === cat).map((i) => `
            <div class="row">
              <span>${escapeHtml(i.name)}<br><span class="muted">${formatINR(i.price)}</span></span>
              <span style="display:flex;gap:8px;align-items:center">
                ${isOwner ? `<button class="btn-ghost edit" data-id="${i.id}"
                     style="padding:8px 12px;font-size:.85rem">Edit</button>` : ''}
                <button class="btn-ghost avail" data-id="${i.id}" data-on="${i.is_available}"
                        style="padding:8px 12px;font-size:.85rem">
                  ${i.is_available ? 'Available' : 'Sold out'}
                </button>
              </span>
            </div>`).join('')}
        </div>`).join('')}
    </div>`;

  document.querySelectorAll('.avail').forEach((b) => b.addEventListener('click', async () => {
    await db.setAvailability(b.dataset.id, b.dataset.on !== 'true');
    await renderMenuTab();
    await renderOrdersTab();
  }));

  if (!isOwner) return;

  document.querySelectorAll('.edit').forEach((b) => b.addEventListener('click', async () => {
    const item = menuItems.find((i) => i.id === b.dataset.id);
    const name = prompt('Name', item.name);
    if (name === null) return;
    const price = prompt('Price', item.price);
    if (price === null) return;
    const trimmedName = name.trim();
    const amount = parseAmount(price);
    if (!trimmedName) { alert('Enter a valid name.'); return; }
    if (amount === null) { alert('Enter a valid price.'); return; }
    const { error } = await supabase.from('menu_items')
      .update({ name: trimmedName, price: amount }).eq('id', item.id);
    if (error) { alert(error.message); return; }
    await renderMenuTab();
    await renderOrdersTab();
  }));

  document.getElementById('mi-save').addEventListener('click', async () => {
    const err = document.getElementById('mi-error');
    err.classList.add('hidden');
    const name = document.getElementById('mi-name').value.trim();
    const amount = parseAmount(document.getElementById('mi-price').value);
    if (!name) { err.textContent = 'Enter a valid name.'; err.classList.remove('hidden'); return; }
    if (amount === null) { err.textContent = 'Enter a valid price.'; err.classList.remove('hidden'); return; }
    const { error } = await supabase.from('menu_items').insert({
      name,
      category: document.getElementById('mi-cat').value,
      price: amount,
    });
    if (error) { err.textContent = error.message; err.classList.remove('hidden'); return; }
    await renderMenuTab();
    await renderOrdersTab();
  });
}
```

Add `import { supabase } from './supabase.js';` at the top of `js/admin.js`, and call `renderMenuTab()` from the `admin:ready` handler and from the Menu tab button.

- [ ] **Step 2: Verify as owner**

1. Add "Ragi Java" to Drinks at ₹40 — it appears in the list and as a button in Orders.
2. Edit its price to ₹45 — both places update.
3. Toggle it to Sold out — it disappears from the Orders item buttons.

- [ ] **Step 3: Verify as staff**

1. No "Add item" card is visible.
2. No Edit buttons are visible.
3. Toggling availability **works** — this is the deliberate staff permission.
4. In the console, confirm the database refuses a price change:

```js
const { error } = await (await import('./js/supabase.js')).supabase
  .from('menu_items').update({ price: 1 }).eq('name', 'Ragi Java');
console.log(error);
```

Expected: zero rows affected; price unchanged in the SQL editor.

- [ ] **Step 4: Commit**

```bash
git add js/admin.js
git commit -m "feat: add menu tab with role-aware controls"
```

---

### Task 10: CSV export

**Files:**
- Modify: `js/db.js`, `js/admin.js`

**Interfaces:**
- Consumes: `toCsv` from Task 5
- Produces: `db.exportRange(from, to)`, owner-only export card

- [ ] **Step 1: Add the query to `js/db.js`**

```js
export async function exportRange(from, to) {
  const { data, error } = await supabase
    .from('orders')
    .select('business_date, created_at, order_type, description, total_amount, payment_mode, status, order_items(item_name, unit_price, quantity, line_total)')
    .gte('business_date', from).lte('business_date', to)
    .order('created_at');
  if (error) throw error;

  // One CSV row per line item; catering orders emit a single row.
  const rows = [];
  for (const o of data) {
    const base = {
      date: o.business_date,
      time: new Date(o.created_at).toLocaleTimeString('en-IN'),
      type: o.order_type,
      description: o.description || '',
      payment: o.payment_mode,
      status: o.status,
      order_total: o.total_amount,
    };
    if (o.order_items?.length) {
      for (const i of o.order_items) {
        rows.push({ ...base, item: i.item_name, unit_price: i.unit_price,
                    quantity: i.quantity, line_total: i.line_total });
      }
    } else {
      rows.push({ ...base, item: '', unit_price: '', quantity: '', line_total: '' });
    }
  }
  return rows;
}
```

- [ ] **Step 2: Add the export card to `js/admin.js`**

```js
import { toCsv } from './lib/csv.js';
import { istBusinessDate } from './lib/date.js';

const EXPORT_COLUMNS = ['date','time','type','description','item','unit_price',
                        'quantity','line_total','order_total','payment','status'];

function renderExport() {
  if (state.role !== 'owner') return;
  const today = istBusinessDate();
  document.getElementById('tab-orders').insertAdjacentHTML('beforeend', `
    <div class="card">
      <h3>Export</h3>
      <label for="ex-from">From</label><input id="ex-from" type="date" value="${today}">
      <label for="ex-to">To</label><input id="ex-to" type="date" value="${today}">
      <div style="margin-top:14px"><button class="btn-gold" id="ex-go"
           style="width:100%">Download CSV</button></div>
    </div>`);

  document.getElementById('ex-go').addEventListener('click', async () => {
    const from = document.getElementById('ex-from').value;
    const to   = document.getElementById('ex-to').value;
    const rows = await db.exportRange(from, to);
    const blob = new Blob([toCsv(rows, EXPORT_COLUMNS)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `amrithaha-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
}
```

Call `renderExport()` at the end of `renderOrdersTab()`.

> **Superseded by commit `5c9add5`.** The snippets above were hardened during
> review and the shipped `js/db.js` / `js/admin.js` are authoritative for this
> task. Four changes: `exportRange` now paginates with `.range()` in pages of
> 1000 ordered by `created_at, id` (an unbounded select is silently capped by
> PostgREST, which would drop rows from the only backup this system has);
> `js/lib/csv.js` prefixes strings that begin with `=`, `+`, `-`, `@`, tab or CR
> with an apostrophe so a menu name cannot execute as a spreadsheet formula,
> while numbers pass through untouched so negatives stay numeric; the export
> handler has try/catch with a visible `#ex-error` message and a disabled
> button while running; and blank or inverted date ranges are rejected before
> the query runs.

- [ ] **Step 3: Verify the export**

1. As owner, export today. A CSV downloads.
2. Open it in a spreadsheet: one row per line item, catering on its own row.
3. Sum `order_total` over distinct orders where `status = valid` — it must equal the dashboard revenue.
4. Add a menu item containing a comma (`Dosa, Special`), sell it, re-export, and confirm the column alignment survives.
5. As staff, confirm no Export card appears.

- [ ] **Step 4: Commit**

```bash
git add js/db.js js/admin.js
git commit -m "feat: add owner-only CSV export"
```

---

### Task 11: Public menu page

**Files:**
- Create: `menu.html`, `js/menu-public.js`

**Interfaces:**
- Consumes: anonymous read on `menu_items`
- Produces: a public page reflecting admin changes with no code edit

- [ ] **Step 1: Write `menu.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Menu — Amrithaha</title>
<meta name="description" content="Today's millet-based menu at Amrithaha, Madhapur.">
<link rel="icon" href="Logos/amrithaha_icon_light.svg" type="image/svg+xml">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Poppins:wght@400;500;600&family=Noto+Sans+Telugu:wght@400;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="css/app.css">
<style>
  .menu-head{text-align:center;padding:28px 0 8px}
  .menu-head img{width:84px;margin:0 auto 10px}
  .menu-head h1{font-family:'Fraunces',Georgia,serif;font-size:2rem}
  .menu-head p{color:var(--muted)}
  .te{font-family:'Noto Sans Telugu',sans-serif;color:var(--green-500)}
  .cat{font-family:'Fraunces',Georgia,serif;color:var(--green-700);
       font-size:1.25rem;margin:22px 0 6px}
</style>
</head>
<body>
<div class="wrap">
  <div class="menu-head">
    <img src="Logos/amrithaha_icon_light.svg" alt="">
    <h1>Amrithaha</h1>
    <p>Millet based · Healthy · <span class="te">అమృతః</span></p>
  </div>
  <div id="menu-root"><p class="muted">Loading menu…</p></div>
  <p class="muted" style="text-align:center;margin:26px 0">
    <a href="index.html" style="color:var(--green-700)">← Back to Amrithaha</a>
  </p>
</div>
<script type="module" src="js/menu-public.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `js/menu-public.js`**

```js
import { listMenuItems } from './db.js';
import { formatINR } from './lib/money.js';
import { escapeHtml } from './lib/html.js';

const CATEGORY_ORDER = ['Breakfast', 'Lunch', 'Drinks', 'Shelf'];

try {
  const items = (await listMenuItems()).filter((i) => i.is_available);
  const root = document.getElementById('menu-root');

  if (!items.length) {
    root.innerHTML = '<p class="muted">Menu is being updated. Please call us.</p>';
  } else {
    const cats = CATEGORY_ORDER.filter((c) => items.some((i) => i.category === c));
    root.innerHTML = cats.map((cat) => `
      <div class="cat">${escapeHtml(cat)}</div>
      <div class="card">
        ${items.filter((i) => i.category === cat).map((i) => `
          <div class="row"><span>${escapeHtml(i.name)}</span><strong>${formatINR(i.price)}</strong></div>
        `).join('')}
      </div>`).join('');
  }
} catch (e) {
  document.getElementById('menu-root').innerHTML =
    '<p class="muted">Could not load the menu right now. Please call us on +91 93921 16251.</p>';
}
```

- [ ] **Step 3: Verify the public page**

1. Open `http://localhost:5000/menu.html` **in a private window** (no session) — the menu renders. This proves anonymous read works.
2. In admin, mark an item sold out — reload `menu.html`, it is gone.
3. Change a price in admin — reload, the new price shows.
4. Open DevTools → Application → Local Storage and confirm no session is required.
5. In a private window console, confirm sales stay private:

```js
const { data, error } = await (await import('./js/supabase.js')).supabase
  .from('orders').select('*');
console.log(data, error);
```

Expected: `data` is `[]` — anonymous users read nothing from `orders`.

- [ ] **Step 4: Commit**

```bash
git add menu.html js/menu-public.js
git commit -m "feat: add public menu page driven by the database"
```

---

### Task 12: Deployment and final verification

**Files:**
- Modify: `index.html` — **the one permitted change**: a link to the menu page
- Create: `docs/superpowers/plans/RUNBOOK.md`

- [ ] **Step 1: Add the menu link to `index.html`**

This is the only edit to `index.html` in this plan. In the `.menu-note` paragraph of the food section, change the existing link so customers can reach prices:

```html
      <p class="menu-note">Menu changes daily based on fresh preparation. <a href="menu.html" style="color:var(--green-500);font-weight:600">See today's menu →</a></p>
```

- [ ] **Step 2: Write the runbook**

`docs/superpowers/plans/RUNBOOK.md`:

```markdown
# Amrithaha admin runbook

## Daily use
- Staff open `/admin.html`, sign in as the counter account, log every order.
- Wrong order: tap **Undo** on the newest, or **Mark invalid** on an older one.
- Item sold out: Menu tab, tap the item's Available button.

## Owner tasks
- Prices and new items: Menu tab.
- Export: Orders tab, pick a date range, Download CSV. Do this at least weekly —
  it is the only copy of the data outside Supabase.

## Adding a person
1. Supabase → Authentication → Users → Add user (signups stay disabled).
2. `insert into public.profiles (id, role) values ('<uuid>', 'staff');`

## After any change to policies or functions
Run `sql/verify_rls.sql`. All nine assertions must pass.

## Things that must stay true
- Public signups OFF in Supabase Auth settings.
- No `service_role` key anywhere in this repository.
- Nobody deletes orders; mistakes are marked invalid.
```

- [ ] **Step 3: Run the full verification suite**

```bash
npm test
```
Expected: 18 tests pass.

Then run `sql/verify_rls.sql` in Supabase. Expected: nine `PASS:` notices, no exception.

- [ ] **Step 4: Work the manual QA checklist from the spec**

- [ ] Staff login can toggle availability but cannot change a price
- [ ] Staff login cannot edit an amount
- [ ] Undo on a just-saved order invalidates it and refills the entry form
- [ ] An order entered after 8:00pm IST appears on that day's dashboard, not the next
- [ ] Marking an order invalid removes it from revenue while it stays visible
- [ ] Invalid orders are excluded from items-sold and top-items, not just revenue
- [ ] A catering order appears in the day's revenue alongside counter sales
- [ ] Public `menu.html` shows available items only, and reflects a price change
- [ ] CSV export opens in a spreadsheet with totals matching the dashboard
- [ ] Signing out and reloading `admin.html` shows the login screen, not data

For the 8:00pm IST check without waiting: insert a row with an explicit late timestamp and confirm it lands on the right `business_date`:

```sql
select ((timestamptz '2026-08-10 15:30:00+00') at time zone 'Asia/Kolkata')::date;
-- expected: 2026-08-10  (21:00 IST, still the same business day)
select ((timestamptz '2026-08-10 19:00:00+00') at time zone 'Asia/Kolkata')::date;
-- expected: 2026-08-11  (00:30 IST, next business day)
```

- [ ] **Step 5: Deploy and verify live**

```bash
git add index.html docs/superpowers/plans/RUNBOOK.md
git commit -m "feat: link public menu from the site and add runbook"
git push origin main
```

Wait for GitHub Pages to rebuild, then on a phone:

1. `/menu.html` loads and shows current prices.
2. `/admin.html` login works; log a real order one-handed and time it — under five seconds is the target.
3. The dashboard total matches what is in the till.

- [ ] **Step 6: Final commit**

```bash
git commit --allow-empty -m "chore: admin sales tracking verified live"
git push origin main
```

---

## Notes for the implementer

**`admin.html` is not secret.** It carries `noindex`, but anyone can open it. That is fine — it shows nothing without a login, and every rule is enforced in Postgres rather than by hiding the page. Do not add fake protection like a hardcoded password check in JavaScript; it would add no security and would imply a guarantee that isn't there.

**`js/admin.js` grows across Tasks 6–10.** If it passes roughly 400 lines, split it into `js/admin-orders.js` and `js/admin-menu.js` with `js/admin.js` as the shell. Do not split it earlier — premature splitting makes the wiring harder to follow while it is being built.

**When a save fails, never clear the bill.** The staff member is standing in front of a customer. Losing the entry is worse than any error message.
