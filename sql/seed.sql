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
