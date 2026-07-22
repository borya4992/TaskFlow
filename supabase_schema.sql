-- Topshiriqlar monitoringi — Supabase jadval sxemasi (workflow bilan)
-- Buni Supabase loyihangizda "SQL Editor" bo'limiga to'liq nusxalab, "Run" tugmasini bosing.

create extension if not exists pgcrypto;

-- ============================================================
-- 1) FOYDALANUVCHILAR
-- ============================================================
create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  email text,
  phone text,
  telegram_id text,
  telegram_username text,
  avatar_url text default '',
  department text default '',
  position_level text default 'xodim' check (position_level in (
    'direktor', 'orinbosar', 'bolim_boshligi', 'xodim'
  )),
  gender text default 'erkak' check (gender in ('erkak', 'ayol')),
  last_seen timestamptz,
  role text not null default 'executor' check (role in (
    'admin', 'director', 'deputy_director', 'dept_head', 'executor'
  )),
  auth_user_id uuid references auth.users(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz default now(),
  constraint app_users_contact_check check (
    email is not null or phone is not null or telegram_id is not null
  )
);

-- Mavjud bazada rollarni yangilash
alter table app_users add column if not exists avatar_url text default '';
alter table app_users add column if not exists department text default '';
alter table app_users add column if not exists last_seen timestamptz;
alter table app_users add column if not exists position_level text default 'xodim';
alter table app_users add column if not exists gender text default 'erkak';

-- Jins constraint
alter table app_users drop constraint if exists app_users_gender_check;
update app_users set gender = 'erkak'
where gender is null or gender = '' or gender not in ('erkak', 'ayol');
alter table app_users add constraint app_users_gender_check
  check (gender in ('erkak', 'ayol'));

-- Lavozim darajasi constraint
alter table app_users drop constraint if exists app_users_position_level_check;
update app_users set position_level = case
  when role = 'director' then 'direktor'
  when role = 'deputy_director' then 'orinbosar'
  when role = 'dept_head' then 'bolim_boshligi'
  else coalesce(nullif(position_level, ''), 'xodim')
end
where position_level is null
   or position_level = ''
   or position_level not in ('direktor', 'orinbosar', 'bolim_boshligi', 'xodim');
alter table app_users add constraint app_users_position_level_check
  check (position_level in ('direktor', 'orinbosar', 'bolim_boshligi', 'xodim'));

alter table app_users drop constraint if exists app_users_role_check;
update app_users set role = 'executor' where role = 'member';
alter table app_users add constraint app_users_role_check
  check (role in ('admin', 'director', 'deputy_director', 'dept_head', 'executor'));

create unique index if not exists app_users_email_unique
  on app_users (lower(email)) where email is not null;
create unique index if not exists app_users_phone_unique
  on app_users (phone) where phone is not null;
create unique index if not exists app_users_telegram_unique
  on app_users (telegram_id) where telegram_id is not null;

-- ============================================================
-- 2) TOPSHIRIQLAR
-- status: jarayonda | tekshiruvda | bajarildi
-- ============================================================
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  assignee text not null,
  assignee_user_id uuid references app_users(id) on delete set null,
  created_by_user_id uuid references app_users(id) on delete set null,
  title text not null,
  priority text default '',
  start_date date default current_date,
  deadline timestamptz,
  status text default 'jarayonda',
  comment text default '',
  created_at timestamptz default now()
);

alter table tasks add column if not exists assignee_user_id uuid references app_users(id) on delete set null;
alter table tasks add column if not exists created_by_user_id uuid references app_users(id) on delete set null;

-- Muddatga soat qo'llab-quvvatlash (eski date → timestamptz)
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tasks'
      and column_name = 'deadline' and data_type = 'date'
  ) then
    alter table tasks
      alter column deadline type timestamptz
      using case
        when deadline is null then null
        else (deadline::timestamp + time '23:59:00') at time zone 'Asia/Tashkent'
      end;
  end if;
end $$;

-- ============================================================
-- 3) SOZLAMALAR
-- ============================================================
create table if not exists settings (
  id int primary key default 1,
  telegram_token text default '',
  telegram_chat_id text default '',
  telegram_bot_username text default '',
  notifications_enabled boolean default false,
  constraint single_row check (id = 1)
);
insert into settings (id) values (1) on conflict (id) do nothing;
alter table settings add column if not exists telegram_bot_username text default '';
alter table settings add column if not exists office3d_public boolean default false;

-- Soft-delete topshiriqlar
alter table tasks add column if not exists deleted_at timestamptz;

-- Topshiriqqa biriktirilgan fayl (Telegram file_id orqali)
alter table tasks add column if not exists attachment_file_id text default '';
alter table tasks add column if not exists attachment_name text default '';
alter table tasks add column if not exists attachment_size bigint default 0;

-- Bo'lim nomlarini kanoniklashtirish (dublikatlarni yo'qotish)
update app_users set department = case
  when lower(coalesce(department, '')) ~ '(qabul|hr|recruit)' then 'Ishga qabul qilish bo''limi'
  when lower(coalesce(department, '')) ~ '(kompens|payroll|moliya)' then 'Kompensatsiya bo''limi'
  when lower(coalesce(department, '')) ~ '(xodim|staff|personnel)' then 'Xodimlar bo''limi'
  when trim(coalesce(department, '')) = '' then 'Xodimlar bo''limi'
  when lower(trim(department)) in (
    'xodimlar', 'ishga qabul qilish', 'kompensatsiya',
    'xodimlar bo''limi', 'ishga qabul qilish bo''limi', 'kompensatsiya bo''limi'
  ) then case
    when lower(trim(department)) like '%qabul%' then 'Ishga qabul qilish bo''limi'
    when lower(trim(department)) like '%kompens%' then 'Kompensatsiya bo''limi'
    else 'Xodimlar bo''limi'
  end
  else 'Xodimlar bo''limi'
end
where role <> 'admin' or department is distinct from '';

update app_users set department = ''
where role = 'admin';

-- ============================================================
-- 4) YORDAMCHI FUNKSIYALAR
-- ============================================================

create or replace function public.is_user_invited(
  p_email text default null,
  p_phone text default null,
  p_telegram_id text default null
)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from app_users
    where is_active = true
      and (
        (p_email is not null and lower(email) = lower(trim(p_email)))
        or (p_phone is not null and phone = trim(p_phone))
        or (p_telegram_id is not null and telegram_id = trim(p_telegram_id))
      )
  );
$$;

create or replace function public.link_current_user(
  p_email text default null,
  p_phone text default null,
  p_telegram_id text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  rec app_users;
begin
  if auth.uid() is null then
    return json_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select * into rec from app_users
  where auth_user_id = auth.uid() and is_active = true
  limit 1;

  if rec.id is not null then
    return json_build_object('ok', true, 'user', row_to_json(rec));
  end if;

  update app_users
  set auth_user_id = auth.uid()
  where is_active = true
    and auth_user_id is null
    and (
      (p_email is not null and lower(email) = lower(trim(p_email)))
      or (p_phone is not null and phone = trim(p_phone))
      or (p_telegram_id is not null and telegram_id = trim(p_telegram_id))
    )
  returning * into rec;

  if rec.id is null then
    return json_build_object('ok', false, 'error', 'not_invited');
  end if;

  return json_build_object('ok', true, 'user', row_to_json(rec));
end;
$$;

create or replace function public.get_my_profile()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  rec app_users;
begin
  if auth.uid() is null then
    return json_build_object('ok', false);
  end if;

  select * into rec from app_users
  where auth_user_id = auth.uid() and is_active = true
  limit 1;

  if rec.id is null then
    return json_build_object('ok', false);
  end if;

  return json_build_object('ok', true, 'user', row_to_json(rec));
end;
$$;

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from app_users
    where auth_user_id = auth.uid()
      and role = 'admin'
      and is_active = true
  );
$$;

create or replace function public.is_director_or_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from app_users
    where auth_user_id = auth.uid()
      and role in ('admin', 'director')
      and is_active = true
  );
$$;

create or replace function public.my_user_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select id from app_users
  where auth_user_id = auth.uid() and is_active = true
  limit 1;
$$;

-- ============================================================
-- 5) BIRINCHI ADMIN (timekeeper.1120@gmail.com) — dublikatsiz
-- ============================================================
insert into app_users (display_name, email, role, is_active, department)
select 'Admin', 'timekeeper.1120@gmail.com', 'admin', true, ''
where not exists (
  select 1 from app_users where lower(email) = lower('timekeeper.1120@gmail.com')
);

update app_users
set role = 'admin',
    is_active = true,
    department = '',
    display_name = coalesce(nullif(display_name, ''), 'Admin')
where lower(email) = lower('timekeeper.1120@gmail.com');

-- Admin hech qachon ofis bo'limi bo'lmasin
update app_users
set department = ''
where role = 'admin'
   or lower(trim(coalesce(department, ''))) in ('admin', 'админ');

-- Bir xil email bo'yicha dublikatlarni o'chirish (faqat keyingilarini nofaol qilish)
with ranked as (
  select id,
         row_number() over (
           partition by lower(email)
           order by (role = 'admin') desc, created_at asc nulls last, id asc
         ) as rn
  from app_users
  where email is not null and trim(email) <> ''
)
update app_users u
set is_active = false
from ranked r
where u.id = r.id and r.rn > 1 and u.is_active = true;

-- ============================================================
-- 6) ROW LEVEL SECURITY
-- ============================================================
alter table app_users enable row level security;
alter table tasks enable row level security;
alter table settings enable row level security;

drop policy if exists "app_users_select_own" on app_users;
drop policy if exists "app_users_select_team" on app_users;
create policy "app_users_select_team" on app_users
  for select using (auth.role() = 'authenticated' and is_active = true);

drop policy if exists "app_users_admin_write" on app_users;
create policy "app_users_admin_write" on app_users
  for all using (public.is_admin())
  with check (public.is_admin());

-- Har bir user o'z last_seen (online) holatini yangilashi mumkin
drop policy if exists "app_users_update_own_presence" on app_users;
create policy "app_users_update_own_presence" on app_users
  for update using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

drop policy if exists "tasks_all_access" on tasks;
drop policy if exists "tasks_authenticated" on tasks;
drop policy if exists "tasks_select" on tasks;
drop policy if exists "tasks_insert" on tasks;
drop policy if exists "tasks_update" on tasks;
drop policy if exists "tasks_delete" on tasks;

create policy "tasks_select" on tasks
  for select using (auth.role() = 'authenticated');

-- Har bir autentifikatsiyalangan user topshiriq yaratishi mumkin
create policy "tasks_insert" on tasks
  for insert with check (
    auth.role() = 'authenticated'
    and created_by_user_id = public.my_user_id()
  );

-- Ijrochi: jarayonda → tekshiruvda
-- Yaratuvchi/admin: tekshiruvda → bajarildi yoki qayta ishlash (jarayonda + muddat)
create policy "tasks_update" on tasks
  for update using (
    public.is_admin()
    or created_by_user_id = public.my_user_id()
    or (
      assignee_user_id = public.my_user_id()
      and status in ('jarayonda', 'muddati_otgan')
    )
  )
  with check (
    public.is_admin()
    or created_by_user_id = public.my_user_id()
    or (
      assignee_user_id = public.my_user_id()
      and status = 'tekshiruvda'
    )
  );

create policy "tasks_delete" on tasks
  for delete using (
    public.is_admin()
    or created_by_user_id = public.my_user_id()
  );

drop policy if exists "settings_all_access" on settings;
drop policy if exists "settings_read" on settings;
drop policy if exists "settings_admin_write" on settings;
create policy "settings_read" on settings
  for select using (auth.role() = 'authenticated');

create policy "settings_admin_write" on settings
  for update using (public.is_admin())
  with check (public.is_admin());

grant execute on function public.is_user_invited(text, text, text) to anon, authenticated;
grant execute on function public.link_current_user(text, text, text) to authenticated;
grant execute on function public.get_my_profile() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_director_or_admin() to authenticated;
grant execute on function public.my_user_id() to authenticated;

-- Realtime (allaqachon qo'shilgan bo'lsa xato bermaydi)
do $$
begin
  alter publication supabase_realtime add table tasks;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table app_users;
exception
  when duplicate_object then null;
end $$;

-- ============================================================
-- 7) AVATAR STORAGE
-- ============================================================
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read" on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists "avatars_admin_insert" on storage.objects;
create policy "avatars_admin_insert" on storage.objects
  for insert with check (bucket_id = 'avatars' and public.is_admin());

drop policy if exists "avatars_admin_update" on storage.objects;
create policy "avatars_admin_update" on storage.objects
  for update using (bucket_id = 'avatars' and public.is_admin());

drop policy if exists "avatars_admin_delete" on storage.objects;
create policy "avatars_admin_delete" on storage.objects
  for delete using (bucket_id = 'avatars' and public.is_admin());
