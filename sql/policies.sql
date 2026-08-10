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
