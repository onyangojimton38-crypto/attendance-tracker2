create table if not exists public.teacher_time_logs (
  id uuid primary key default gen_random_uuid(),
  teacher_user_id uuid not null references public.profiles(user_id) on delete cascade,
  work_date date not null,
  clock_in timestamptz not null,
  clock_out timestamptz,
  created_at timestamptz not null default now(),
  constraint teacher_time_logs_one_per_day unique (teacher_user_id, work_date),
  constraint teacher_time_logs_clock_order check (clock_out is null or clock_out >= clock_in)
);

create index if not exists teacher_time_logs_work_date_idx
  on public.teacher_time_logs (work_date desc, clock_in desc);

alter table public.teacher_time_logs enable row level security;

drop policy if exists "Teachers and admins can read teacher time logs" on public.teacher_time_logs;
create policy "Teachers and admins can read teacher time logs"
  on public.teacher_time_logs
  for select
  to authenticated
  using (
    teacher_user_id = (select auth.uid())
    or exists (
      select 1
      from public.profiles
      where profiles.user_id = (select auth.uid())
        and profiles.role = 'admin'
    )
  );

revoke all on table public.teacher_time_logs from anon, authenticated;
grant select on table public.teacher_time_logs to authenticated;

create or replace function public.teacher_clock_in()
returns public.teacher_time_logs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  v_now timestamptz;
  work_day date;
  new_record public.teacher_time_logs;
begin
  if current_user_id is null then
    raise exception 'Sign in is required to clock in.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.profiles
    where user_id = current_user_id and role = 'teacher'
  ) then
    raise exception 'Only teacher accounts can use the time clock.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext(current_user_id::text));
  v_now := clock_timestamp();
  work_day := (v_now at time zone 'Africa/Nairobi')::date;

  if exists (
    select 1 from public.teacher_time_logs
    where teacher_user_id = current_user_id and clock_out is null
  ) then
    raise exception 'Clock out of your current work session before starting another.';
  end if;

  insert into public.teacher_time_logs (teacher_user_id, work_date, clock_in)
  values (current_user_id, work_day, v_now)
  on conflict (teacher_user_id, work_date) do nothing
  returning * into new_record;

  if new_record.id is null then
    raise exception 'You have already clocked in for this workday.';
  end if;

  return new_record;
end;
$$;

create or replace function public.teacher_clock_out()
returns public.teacher_time_logs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  open_record public.teacher_time_logs;
begin
  if current_user_id is null then
    raise exception 'Sign in is required to clock out.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.profiles
    where user_id = current_user_id and role = 'teacher'
  ) then
    raise exception 'Only teacher accounts can use the time clock.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext(current_user_id::text));

  select * into open_record
  from public.teacher_time_logs
  where teacher_user_id = current_user_id and clock_out is null
  order by work_date desc
  limit 1
  for update;

  if open_record.id is null then
    raise exception 'There is no open work session to clock out of.';
  end if;

  update public.teacher_time_logs
  set clock_out = clock_timestamp()
  where id = open_record.id
  returning * into open_record;

  return open_record;
end;
$$;

revoke all on function public.teacher_clock_in() from public, anon;
revoke all on function public.teacher_clock_out() from public, anon;
grant execute on function public.teacher_clock_in() to authenticated;
grant execute on function public.teacher_clock_out() to authenticated;
