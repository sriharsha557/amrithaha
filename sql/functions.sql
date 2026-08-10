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
