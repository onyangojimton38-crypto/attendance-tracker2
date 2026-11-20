-- Run this file once in the Supabase SQL Editor.
-- Create accounts in Supabase Authentication, then insert their matching role/profile rows below.
-- Example after creating a school administrator account:
-- insert into public.profiles (user_id, full_name, email, role)
-- values ('AUTH-USER-UUID', 'School Administrator', 'admin@school.example', 'admin');

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null unique,
  phone text,
  role text not null check (role in ('admin', 'teacher', 'student', 'guardian')),
  class_id uuid,
  student_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  teacher_id uuid references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  student_code text not null unique,
  full_name text not null,
  class_id uuid not null references public.classes(id) on delete restrict,
  gender text,
  parent_phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.students add column if not exists gender text;
alter table public.students add column if not exists parent_phone text;
alter table public.students add column if not exists is_active boolean not null default true;
alter table public.students add column if not exists updated_at timestamptz not null default now();
alter table public.classes add column if not exists teacher_id uuid references public.profiles(user_id) on delete set null;
alter table public.profiles add column if not exists class_id uuid;
alter table public.profiles add column if not exists student_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_class_id_fkey'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_class_id_fkey
      foreign key (class_id) references public.classes(id) on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_student_id_fkey'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_student_id_fkey
      foreign key (student_id) references public.students(id) on delete set null;
  end if;
end;
$$;

create table if not exists public.attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  attendance_date date not null,
  subject text not null default 'General',
  marked_by uuid not null references public.profiles(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_sessions_one_per_class_day unique (class_id, attendance_date)
);

create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.attendance_sessions(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  status text not null check (status in ('present', 'absent', 'late', 'excused')),
  absence_reason text,
  updated_at timestamptz not null default now(),
  constraint attendance_records_one_per_student unique (session_id, student_id)
);

create table if not exists public.absence_reasons (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  attendance_date date not null,
  submitted_by uuid not null references public.profiles(user_id),
  reason text not null,
  submitted_at timestamptz not null default now(),
  constraint absence_reasons_one_per_student_day unique (student_id, attendance_date)
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  student_id uuid references public.students(id) on delete set null,
  attendance_date date,
  actor_id uuid references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists students_class_active_name_idx
  on public.students (class_id, is_active, full_name);
create unique index if not exists classes_one_teacher_idx
  on public.classes (teacher_id) where teacher_id is not null;
create index if not exists attendance_sessions_date_idx
  on public.attendance_sessions (attendance_date desc, class_id);
create index if not exists attendance_records_student_idx
  on public.attendance_records (student_id, session_id);
create index if not exists audit_events_created_idx
  on public.audit_events (created_at desc);

create or replace function public.current_school_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role from public.profiles where user_id = auth.uid()
$$;

create or replace function public.can_access_class(target_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and (
        p.role = 'admin'
        or (p.role = 'teacher' and exists (
          select 1 from public.classes c
          where c.id = target_class_id and c.teacher_id = p.user_id
        ))
        or (p.role in ('student', 'guardian') and exists (
          select 1 from public.students s
          where s.id = p.student_id and s.class_id = target_class_id
        ))
      )
  )
$$;

create or replace function public.can_mark_class(target_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and (
        p.role = 'admin'
        or (p.role = 'teacher' and exists (
          select 1 from public.classes c
          where c.id = target_class_id and c.teacher_id = p.user_id
        ))
      )
  )
$$;

create or replace function public.can_access_student(target_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    join public.students s on s.id = target_student_id
    where p.user_id = auth.uid()
      and (
        p.role = 'admin'
        or (p.role = 'teacher' and exists (
          select 1 from public.classes c
          where c.id = s.class_id and c.teacher_id = p.user_id
        ))
        or (p.role in ('student', 'guardian') and p.student_id = s.id)
      )
  )
$$;

revoke all on function public.current_school_role() from public, anon;
revoke all on function public.can_access_class(uuid) from public, anon;
revoke all on function public.can_mark_class(uuid) from public, anon;
revoke all on function public.can_access_student(uuid) from public, anon;
grant execute on function public.current_school_role() to authenticated;
grant execute on function public.can_access_class(uuid) to authenticated;
grant execute on function public.can_mark_class(uuid) to authenticated;
grant execute on function public.can_access_student(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.classes enable row level security;
alter table public.students enable row level security;
alter table public.attendance_sessions enable row level security;
alter table public.attendance_records enable row level security;
alter table public.absence_reasons enable row level security;
alter table public.audit_events enable row level security;

drop policy if exists "Profiles visible to account and admins" on public.profiles;
create policy "Profiles visible to account and admins"
  on public.profiles for select to authenticated
  using (user_id = (select auth.uid()) or public.current_school_role() = 'admin');

drop policy if exists "Classes visible to signed-in accounts" on public.classes;
create policy "Classes visible to signed-in accounts"
  on public.classes for select to authenticated
  using (public.can_access_class(id));
drop policy if exists "Admins manage classes" on public.classes;
create policy "Admins manage classes"
  on public.classes for all to authenticated
  using (public.current_school_role() = 'admin')
  with check (public.current_school_role() = 'admin');

drop policy if exists "Students visible to assigned accounts" on public.students;
create policy "Students visible to assigned accounts"
  on public.students for select to authenticated
  using (public.can_access_student(id));
drop policy if exists "Admins manage students" on public.students;
create policy "Admins manage students"
  on public.students for all to authenticated
  using (public.current_school_role() = 'admin')
  with check (public.current_school_role() = 'admin');

drop policy if exists "Attendance sessions visible to assigned accounts" on public.attendance_sessions;
create policy "Attendance sessions visible to assigned accounts"
  on public.attendance_sessions for select to authenticated
  using (public.can_access_class(class_id));
drop policy if exists "Staff manage attendance sessions" on public.attendance_sessions;
create policy "Staff manage attendance sessions"
  on public.attendance_sessions for all to authenticated
  using (public.can_mark_class(class_id))
  with check (public.can_mark_class(class_id));

drop policy if exists "Attendance records visible to assigned accounts" on public.attendance_records;
create policy "Attendance records visible to assigned accounts"
  on public.attendance_records for select to authenticated
  using (public.can_access_student(student_id));
drop policy if exists "Staff manage attendance records" on public.attendance_records;
create policy "Staff manage attendance records"
  on public.attendance_records for all to authenticated
  using (
    exists (
      select 1 from public.attendance_sessions s
      where s.id = session_id and public.can_mark_class(s.class_id)
    )
  )
  with check (
    exists (
      select 1 from public.attendance_sessions s
      where s.id = session_id and public.can_mark_class(s.class_id)
    )
  );

drop policy if exists "Absence reasons visible to assigned accounts" on public.absence_reasons;
create policy "Absence reasons visible to assigned accounts"
  on public.absence_reasons for select to authenticated
  using (public.can_access_student(student_id));
drop policy if exists "Students and staff submit absence reasons" on public.absence_reasons;
create policy "Students and staff submit absence reasons"
  on public.absence_reasons for insert to authenticated
  with check (
    submitted_by = (select auth.uid())
    and public.can_access_student(student_id)
  );
drop policy if exists "Submitter updates absence reason" on public.absence_reasons;
create policy "Submitter updates absence reason"
  on public.absence_reasons for update to authenticated
  using (submitted_by = (select auth.uid()) and public.can_access_student(student_id))
  with check (submitted_by = (select auth.uid()) and public.can_access_student(student_id));

drop policy if exists "Admins read audit events" on public.audit_events;
create policy "Admins read audit events"
  on public.audit_events for select to authenticated
  using (public.current_school_role() = 'admin');

grant select on public.profiles, public.classes, public.students,
  public.attendance_sessions, public.attendance_records,
  public.absence_reasons, public.audit_events to authenticated;
grant insert, update, delete on public.classes to authenticated;
grant insert, update on public.students to authenticated;
grant insert, update on public.absence_reasons to authenticated;

create or replace function public.log_attendance_record_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  session_date date;
begin
  select attendance_date into session_date
  from public.attendance_sessions
  where id = new.session_id;

  insert into public.audit_events (event_type, student_id, attendance_date, actor_id)
  values (
    case when tg_op = 'INSERT' then 'attendance_marked' else 'attendance_changed' end,
    new.student_id,
    session_date,
    auth.uid()
  );
  return new;
end;
$$;

drop trigger if exists attendance_record_audit on public.attendance_records;
create trigger attendance_record_audit
  after insert or update on public.attendance_records
  for each row execute function public.log_attendance_record_change();

create or replace function public.save_attendance_session(
  target_class_id uuid,
  target_date date,
  target_subject text,
  records jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  session_id uuid;
  expected_count integer;
  supplied_count integer;
begin
  if not public.can_mark_class(target_class_id) then
    raise exception 'You are not allowed to mark attendance for this class.' using errcode = '42501';
  end if;
  if target_date is null or nullif(btrim(target_subject), '') is null then
    raise exception 'Choose a date and subject before saving attendance.';
  end if;
  if jsonb_typeof(records) <> 'array' then
    raise exception 'Attendance records must be an array.';
  end if;

  select count(*) into expected_count
  from public.students
  where class_id = target_class_id and is_active;
  select count(distinct item.student_id) into supplied_count
  from jsonb_to_recordset(records) as item(student_id uuid, status text, absence_reason text);
  if expected_count = 0 or supplied_count <> expected_count then
    raise exception 'Mark every active student in this class before saving.';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(records) as item(student_id uuid, status text, absence_reason text)
    left join public.students s
      on s.id = item.student_id
      and s.class_id = target_class_id
      and s.is_active
    where s.id is null
      or item.status not in ('present', 'absent', 'late', 'excused')
      or (item.status = 'absent' and coalesce(item.absence_reason, 'No reason') not in ('Sick', 'Fees', 'Family', 'No reason'))
  ) then
    raise exception 'Attendance contains an invalid student, status, or absence reason.';
  end if;

  perform pg_advisory_xact_lock(hashtext(target_class_id::text || target_date::text));

  insert into public.attendance_sessions (class_id, attendance_date, subject, marked_by)
  values (target_class_id, target_date, btrim(target_subject), auth.uid())
  on conflict (class_id, attendance_date) do update
    set subject = excluded.subject,
        marked_by = excluded.marked_by,
        updated_at = now()
  returning id into session_id;

  insert into public.attendance_records (session_id, student_id, status, absence_reason, updated_at)
  select session_id, item.student_id, item.status,
         case when item.status = 'absent' then coalesce(item.absence_reason, 'No reason') else null end,
         now()
  from jsonb_to_recordset(records) as item(student_id uuid, status text, absence_reason text)
  on conflict (session_id, student_id) do update
    set status = excluded.status,
        absence_reason = excluded.absence_reason,
        updated_at = excluded.updated_at;

  return session_id;
end;
$$;

revoke all on function public.save_attendance_session(uuid, date, text, jsonb) from public, anon;
grant execute on function public.save_attendance_session(uuid, date, text, jsonb) to authenticated;
