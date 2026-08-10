-- Amrithaha security gate. Run after any change to policies or functions.
--
-- HOW TO RUN
--   1. Replace <staff-uuid> and <owner-uuid> below with the real UUIDs from
--      Supabase -> Authentication -> Users.
--   2. Paste this ENTIRE file into the Supabase SQL editor and run it once.
--      It seeds fixtures, asserts, and rolls everything back at the end.
--   3. Expect thirteen PASS notices and no exception. Any FAIL means the
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
--   does not raise. INSERT is the one case that raises insufficient_privilege
--   -- either because a WITH CHECK clause is violated (menu_items) or because
--   the table has no INSERT policy at all (orders). The assertions below match
--   those semantics.

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

-- 7. staff cannot insert directly into orders
--    This is the actual attack: forging a bill with an arbitrary amount.
--    With no INSERT policy on the table, Postgres raises insufficient_privilege.
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select staff_uuid from _v),
                      'role', 'authenticated')::text, true);
  begin
    insert into public.orders (order_type, total_amount, payment_mode)
    values ('counter', 1, 'cash');
    reset role;
    raise exception 'FAIL: staff inserted an order directly';
  exception
    when insufficient_privilege then
      reset role;
      raise notice 'PASS: staff cannot insert directly into orders';
  end;
end $$;

-- ============ must SUCCEED ============

-- 8. anonymous can read the menu
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

-- 9. the owner CAN change an order amount.
--    Positive control: without this, a deny-everyone misconfiguration would
--    pass assertions 1-7 while leaving the app unusable.
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

-- 10. staff can call create_counter_order
--     This is staff's write path for recording a sale. Total is re-derived
--     server-side (100 x 2 = 200), re-proving prices come from the server.
do $$
declare v_id uuid; v_total numeric;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select staff_uuid from _v),
                      'role', 'authenticated')::text, true);
  -- Capture the id. A table-wide count would raise a false FAIL on any
  -- database that already holds an unrelated 200-rupee counter bill.
  select public.create_counter_order('cash',
    jsonb_build_array(jsonb_build_object(
      'menu_item_id', 'dddddddd-0000-0000-0000-000000000001',
      'quantity', 2))) into v_id;
  reset role;
  if v_id is null then
    raise exception 'FAIL: create_counter_order returned no order id';
  end if;
  select total_amount into v_total from public.orders where id = v_id;
  if v_total <> 200 then
    raise exception
      'FAIL: create_counter_order produced total_amount %, expected 200 (100 x 2 read from menu_items)', v_total;
  end if;
  raise notice 'PASS: staff can call create_counter_order';
end $$;

-- 11. staff can call mark_order_invalid
do $$
declare s text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select staff_uuid from _v),
                      'role', 'authenticated')::text, true);
  perform public.mark_order_invalid('dddddddd-0000-0000-0000-000000000002');
  reset role;
  select status into s from public.orders
   where id = 'dddddddd-0000-0000-0000-000000000002';
  if s <> 'invalid' then
    raise exception 'FAIL: order status is %, expected invalid', s;
  end if;
  raise notice 'PASS: staff can call mark_order_invalid';
end $$;

-- 12. staff can call set_item_availability
do $$
declare a boolean;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select staff_uuid from _v),
                      'role', 'authenticated')::text, true);
  perform public.set_item_availability('dddddddd-0000-0000-0000-000000000001', false);
  reset role;
  select is_available into a from public.menu_items
   where id = 'dddddddd-0000-0000-0000-000000000001';
  if a <> false then
    raise exception 'FAIL: menu item is_available is %, expected false', a;
  end if;
  raise notice 'PASS: staff can call set_item_availability';
end $$;

rollback;
