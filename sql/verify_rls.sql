-- Amrithaha security gate. Run after any policy or function change.
-- Every assertion raises an exception if the system is misconfigured.
-- Substitute the real staff UUID before running.

\set staff_uuid '<staff-uuid>'

-- ============ must be REJECTED ============

-- 1. anonymous cannot read orders
do $$
declare n int;
begin
  set local role anon;
  select count(*) into n from public.orders;
  reset role;
  raise exception 'FAIL: anon read % order rows', n;
exception
  when insufficient_privilege then reset role; raise notice 'PASS: anon cannot read orders';
end $$;

-- 2. anonymous cannot read order_items
do $$
declare n int;
begin
  set local role anon;
  select count(*) into n from public.order_items;
  reset role;
  raise exception 'FAIL: anon read % order_item rows', n;
exception
  when insufficient_privilege then reset role; raise notice 'PASS: anon cannot read order_items';
end $$;

-- 3. staff cannot change an order amount
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', :'staff_uuid', 'role','authenticated')::text, true);
  update public.orders set total_amount = 1;
  if found then
    reset role;
    raise exception 'FAIL: staff updated an order amount';
  end if;
  reset role;
  raise notice 'PASS: staff cannot update order amounts';
end $$;

-- 4. staff cannot change a price
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', :'staff_uuid', 'role','authenticated')::text, true);
  update public.menu_items set price = 1;
  if found then
    reset role;
    raise exception 'FAIL: staff updated a menu price';
  end if;
  reset role;
  raise notice 'PASS: staff cannot update prices';
end $$;

-- 5. staff cannot add a menu item
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', :'staff_uuid', 'role','authenticated')::text, true);
  insert into public.menu_items (name, category, price) values ('hack','Lunch',1);
  reset role;
  raise exception 'FAIL: staff inserted a menu item';
exception
  when insufficient_privilege then reset role; raise notice 'PASS: staff cannot insert menu items';
end $$;

-- 6. nobody can delete an order
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', :'staff_uuid', 'role','authenticated')::text, true);
  delete from public.orders;
  if found then
    reset role;
    raise exception 'FAIL: an order was deleted';
  end if;
  reset role;
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
  raise notice 'PASS: anon read % menu items', n;
exception
  when others then reset role; raise exception 'FAIL: anon cannot read the menu';
end $$;
