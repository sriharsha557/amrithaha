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
