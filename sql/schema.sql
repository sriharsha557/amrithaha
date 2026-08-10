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
