import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./supabase-config.js";

const $ = (selector) => document.querySelector(selector);
const STORAGE_KEY = "ke259-attendance-filter-v1";
const colorSets = [
  ["#e6e2ff", "#6558c9"],
  ["#ffe9df", "#c4775a"],
  ["#e0f3ec", "#418b70"],
  ["#ffebef", "#c56d7e"],
  ["#e2eefc", "#5683b4"],
  ["#fff1d9", "#b48736"],
  ["#f3e7f7", "#9969a6"],
  ["#e5f1ee", "#568c82"]
];
const today = localDateString(new Date());
const rows = $("#student-rows");
const dateInput = $("#attendance-date");
const classFilter = $("#class-filter");
const searchInput = $("#student-search");
const loginForm = $("#login-form");
const loginSubmit = $("#login-submit");
const state = {
  client: null,
  user: null,
  profile: null,
  students: [],
  classes: [],
  teachers: [],
  attendance: new Map(),
  attendanceSessions: new Map(),
  pendingAttendance: new Map(),
  pendingAbsenceReasons: new Map(),
  reasons: new Map(),
  attendanceHistory: [],
  reportRows: [],
  auditEvents: [],
  auditActors: new Map(),
  teacherTimeLog: null,
  teacherTimeRecords: [],
  statusFilter: "all",
  toastTimer: null
};

dateInput.value = today;
$("#reason-date").value = today;
$("#report-date").value = today;
const savedFilters = readFilters();
if (savedFilters.classId) state.savedClassId = savedFilters.classId;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  loginSubmit.disabled = true;
} else {
  state.client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  initializeAuth();
}

function localDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function readFilters() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch (error) {
    console.error("Could not read saved attendance filters.", error);
    return {};
  }
}

function saveFilters() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ classId: classFilter.value }));
  } catch (error) {
    console.error("Could not save attendance filters.", error);
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function initials(name) {
  return String(name || "").trim().split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join("").toUpperCase();
}

function setAuthMessage(message, isError = true) {
  const element = $("#auth-message");
  element.textContent = message;
  element.classList.toggle("error", isError);
  element.classList.toggle("success", !isError);
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 3000);
}

function handleError(context, error) {
  console.error(context, error);
  showToast(error?.message || context);
}

async function initializeAuth() {
  const { data, error } = await state.client.auth.getSession();
  if (error) {
    setAuthMessage(`Could not check your session: ${error.message}`);
    return;
  }
  if (data.session) await openSession(data.session.user);

  state.client.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(() => {
      if (!session) closeSession();
    }, 0);
  });

  window.addEventListener("focus", async () => {
    if (state.user) {
      try {
        await loadDayData();
        if (state.profile.role === "teacher") await loadTeacherTimeLog();
        if (state.profile.role === "admin") await loadTeacherTimeRecords();
        if (state.profile.role === "admin") await loadAuditEvents();
        render();
        await refreshAttendanceInsights();
      } catch (error) {
        handleError("Could not refresh attendance data.", error);
      }
    }
  });
}

async function openSession(user) {
  try {
    const { data: profile, error } = await state.client
      .from("profiles")
      .select("user_id,full_name,email,phone,role,class_id,student_id")
      .eq("user_id", user.id)
      .single();
    if (error) throw error;
    if (!profile || !["admin", "teacher", "student", "guardian"].includes(profile.role)) {
      throw new Error("This account has no valid school profile. Contact the school administrator.");
    }

    state.user = user;
    state.profile = profile;
    $("#profile-name").textContent = profile.full_name;
    $("#profile-role").textContent = roleLabel(profile.role);
    $("#profile-avatar").textContent = initials(profile.full_name);
    $("#school-scope").textContent = profile.role === "admin" ? "Schoolwide admin access" : roleLabel(profile.role);
    $("#app-shell").hidden = false;
    $("#login-screen").hidden = true;
    await loadDashboard();
  } catch (error) {
    handleError("Could not load your school profile.", error);
    await state.client.auth.signOut();
    closeSession();
  }
}

function closeSession() {
  state.user = null;
  state.profile = null;
  state.students = [];
  state.classes = [];
  state.teachers = [];
  state.attendance.clear();
  state.attendanceSessions.clear();
  state.pendingAttendance.clear();
  state.pendingAbsenceReasons.clear();
  state.reasons.clear();
  state.teacherTimeLog = null;
  state.teacherTimeRecords = [];
  state.attendanceHistory = [];
  state.reportRows = [];
  $("#app-shell").hidden = true;
  $("#login-screen").hidden = false;
  $("#login-password").value = "";
  loginSubmit.disabled = !state.client;
  loginSubmit.textContent = "Sign in";
}

function roleLabel(role) {
  return {
    admin: "School admin · all classes",
    teacher: "Teacher · assigned class",
    student: "Student account",
    guardian: "Parent / guardian account"
  }[role] || "School account";
}

async function loadDashboard() {
  try {
    const { data: classes, error: classesError } = await state.client
      .from("classes")
      .select("id,name,teacher_id")
      .order("name");
    if (classesError) throw classesError;
    state.classes = classes || [];

    const { data: students, error: studentsError } = await state.client
      .from("students")
      .select("id,student_code,full_name,class_id,gender,parent_phone,is_active,classes(name)")
      .eq("is_active", true)
      .order("full_name");
    if (studentsError) throw studentsError;
    state.students = (students || []).map((student) => ({
      ...student,
      className: student.classes?.name || "Unassigned"
    }));
    populateReportStudents();

    if (state.profile.role === "admin") {
      const { data: teachers, error: teachersError } = await state.client
        .from("profiles")
        .select("user_id,full_name")
        .eq("role", "teacher")
        .order("full_name");
      if (teachersError) throw teachersError;
      state.teachers = teachers || [];
    }
    populateClassFilters();
    populateTeacherOptions();
    populateClassManagementOptions();
    configureRoleView();
    if (state.profile.role === "teacher") {
      try {
        await loadTeacherTimeLog();
      } catch (error) {
        handleError("Could not load your work-time record.", error);
        $("#teacher-timeclock-status").textContent = "The time clock is unavailable. Contact your school administrator.";
        $("#teacher-timeclock-action").disabled = true;
      }
    }
    if (state.profile.role === "admin") {
      try {
        await loadTeacherTimeRecords();
      } catch (error) {
        handleError("Could not load teacher work-time records.", error);
        $("#teacher-time-rows").hidden = true;
        $("#teacher-time-empty").hidden = false;
        $("#teacher-time-empty").textContent = "Teacher time records are unavailable.";
      }
    }
    await loadDayData();
    if (state.profile.role === "admin") await loadAuditEvents();
    render();
    try {
      await refreshAttendanceInsights();
    } catch (error) {
      handleError("Could not load reports and follow-up lists.", error);
    }
  } catch (error) {
    handleError("Could not load attendance data.", error);
  }
}

function populateClassFilters() {
  const availableClasses = state.classes;
  classFilter.replaceChildren(new Option("All classes", "all"));
  $("#student-class").replaceChildren();
  availableClasses.forEach((classItem) => {
    classFilter.add(new Option(classItem.name, classItem.id));
    $("#student-class").add(new Option(classItem.name, classItem.id));
  });
  if (state.profile.role === "admin" && state.savedClassId && availableClasses.some((item) => item.id === state.savedClassId)) {
    classFilter.value = state.savedClassId;
  }
}

function populateTeacherOptions() {
  const select = $("#class-teacher");
  select.replaceChildren(new Option("Not assigned", ""));
  state.teachers.forEach((teacher) => {
    select.add(new Option(teacher.full_name, teacher.user_id));
  });
}

function populateClassManagementOptions() {
  const select = $("#class-edit-target");
  select.replaceChildren(new Option("Create a new class", ""));
  state.classes.forEach((classItem) => {
    select.add(new Option(classItem.name, classItem.id));
  });
}

function populateReportStudents() {
  const select = $("#report-student");
  select.replaceChildren(new Option("All students", "all"));
  state.students.forEach((student) => {
    select.add(new Option(student.full_name, student.id));
  });
  if (state.profile.role === "student" && state.profile.student_id) {
    select.value = state.profile.student_id;
    select.disabled = true;
  } else {
    select.disabled = false;
  }
}

function configureRoleView() {
  const role = state.profile.role;
  const staff = role === "admin" || role === "teacher";
  const admin = role === "admin";
  $("#add-student-button").hidden = !admin;
  $("#add-class-button").hidden = !admin;
  $("#manage-class-button").hidden = !admin;
  $("#export-button").hidden = !staff;
  $("#class-filter").closest(".select-control").hidden = !staff;
  $(".subject-control").hidden = !staff;
  $("#save-attendance-button").hidden = !staff;
  $("#mark-all-button").hidden = !staff;
  $("#admin-activity").hidden = !admin;
  $("#attendance-trends").hidden = false;
  $("#absence-follow-up").hidden = !staff;
  $("#report-panel").hidden = false;
  $("#teacher-timeclock").hidden = role !== "teacher";
  $("#teacher-time-review").hidden = !admin;
  $("#reason-panel").hidden = staff;
  $("#reason-student-field").hidden = role === "student";
  $("#page-title").textContent = role === "admin" ? "School attendance" : role === "teacher" ? "Class attendance" : "My attendance";
  $("#page-subtitle").textContent = admin
    ? "Schoolwide attendance for every class. Attendance changes are recorded."
    : role === "teacher"
      ? "Attendance for your assigned class. Student records stay within your class."
      : "Check attendance and submit a private explanation for an absence.";
  $("#total-detail").textContent = admin ? "Across every class" : role === "teacher" ? "In your assigned class" : "Linked to your account";
  $("#roster-description").textContent = admin
    ? "Schoolwide roster and daily attendance."
    : role === "teacher"
      ? "Attendance for your assigned class."
      : "Attendance records linked to your account.";

  if (role === "teacher") {
    const assignedClass = state.classes.find((item) => item.teacher_id === state.user.id);
    if (assignedClass) classFilter.value = assignedClass.id;
    classFilter.disabled = true;
  } else {
    classFilter.disabled = !admin;
  }
  if (role === "student" || role === "guardian") populateReasonStudents();
}

function populateReasonStudents() {
  const select = $("#reason-student");
  select.replaceChildren();
  state.students.forEach((student) => {
    select.add(new Option(student.full_name, student.id));
  });
}

async function loadDayData() {
  state.attendance.clear();
  state.attendanceSessions.clear();
  state.pendingAttendance.clear();
  state.pendingAbsenceReasons.clear();
  state.reasons.clear();
  const classIds = state.classes.map((classItem) => classItem.id);
  const studentIds = state.students.map((student) => student.id);
  const date = dateInput.value;
  if (classIds.length) {
    const { data: sessions, error: sessionsError } = await state.client
      .from("attendance_sessions")
      .select("id,class_id,attendance_date,subject,marked_by")
      .in("class_id", classIds)
      .eq("attendance_date", date);
    if (sessionsError) throw sessionsError;
    (sessions || []).forEach((session) => state.attendanceSessions.set(session.class_id, session));

    if (classFilter.value !== "all") {
      const currentSession = state.attendanceSessions.get(classFilter.value);
      if (currentSession) {
        const subjectSelect = $("#attendance-subject");
        if (![...subjectSelect.options].some((option) => option.value === currentSession.subject)) {
          subjectSelect.add(new Option(currentSession.subject, currentSession.subject));
        }
        subjectSelect.value = currentSession.subject;
      }
    }

    const sessionIds = (sessions || []).map((session) => session.id);
    if (sessionIds.length) {
      const { data: records, error: recordsError } = await state.client
        .from("attendance_records")
        .select("session_id,student_id,status,absence_reason")
        .in("session_id", sessionIds);
      if (recordsError) throw recordsError;
      (records || []).forEach((record) => {
        state.attendance.set(record.student_id, record);
        state.pendingAttendance.set(record.student_id, record.status);
        if (record.absence_reason) state.pendingAbsenceReasons.set(record.student_id, record.absence_reason);
      });
    }
  }

  if (studentIds.length) {
    const { data: reasons, error: reasonsError } = await state.client
      .from("absence_reasons")
      .select("student_id,attendance_date,submitted_by,reason,submitted_at")
      .in("student_id", studentIds)
      .eq("attendance_date", date);
    if (reasonsError) throw reasonsError;
    (reasons || []).forEach((record) => state.reasons.set(record.student_id, record));
  }
  if (state.profile.role === "student" || state.profile.role === "guardian") renderReasonForm();
  updateAttendanceSessionNote();
  updateSaveAttendanceButton();
}

function getStudentStatus(studentId) {
  return state.pendingAttendance.get(studentId) || state.attendance.get(studentId)?.status || "unmarked";
}

function getSelectedClassStudents() {
  return state.students.filter((student) =>
    classFilter.value === "all" || student.class_id === classFilter.value
  );
}

function updateAttendanceSessionNote() {
  const session = state.attendanceSessions.get(classFilter.value);
  const note = $("#attendance-session-note");
  if (classFilter.value === "all") {
    note.textContent = state.profile.role === "admin"
      ? "Select one class to mark or edit its attendance."
      : "Attendance is read-only in this view.";
  } else if (session) {
    note.textContent = `Attendance already saved for ${formatWorkDate(session.attendance_date)}. Saving will edit that session.`;
  } else {
    note.textContent = "No attendance is saved for this class and date yet. Mark every student, then save once.";
  }
}

function updateSaveAttendanceButton() {
  const button = $("#save-attendance-button");
  if (!button) return;
  const selectedClass = classFilter.value;
  const students = getSelectedClassStudents();
  const canMark = ["admin", "teacher"].includes(state.profile?.role) && selectedClass !== "all";
  const complete = students.length > 0 && students.every((student) =>
    ["present", "absent", "late", "excused"].includes(getStudentStatus(student.id))
  );
  const session = state.attendanceSessions.get(selectedClass);
  const changed = !session
    || session.subject !== $("#attendance-subject").value.trim()
    || students.some((student) => {
      const saved = state.attendance.get(student.id);
      return !saved
        || saved.status !== getStudentStatus(student.id)
        || (saved.absence_reason || "") !== (state.pendingAbsenceReasons.get(student.id) || "");
    });
  button.textContent = session ? "Save changes" : "Save attendance";
  button.disabled = !canMark || !complete || !changed;
}

async function loadAuditEvents() {
  const { data, error } = await state.client
    .from("audit_events")
    .select("id,event_type,student_id,attendance_date,created_at,actor_id")
    .order("created_at", { ascending: false })
    .limit(12);
  if (error) throw error;
  state.auditEvents = data || [];
  state.auditActors.clear();
  const actorIds = [...new Set(state.auditEvents.map((event) => event.actor_id).filter(Boolean))];
  if (!actorIds.length) return;
  const { data: actors, error: actorsError } = await state.client
    .from("profiles")
    .select("user_id,full_name")
    .in("user_id", actorIds);
  if (actorsError) throw actorsError;
  state.auditActors = new Map((actors || []).map((actor) => [actor.user_id, actor.full_name]));
}

function schoolDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const dateParts = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
}

function formatClockTime(value) {
  return new Intl.DateTimeFormat("en-KE", {
    timeZone: "Africa/Nairobi",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatWorkDate(value) {
  return new Intl.DateTimeFormat("en-KE", {
    timeZone: "Africa/Nairobi",
    dateStyle: "medium"
  }).format(new Date(`${value}T00:00:00+03:00`));
}

function formatWorkedTime(clockIn, clockOut) {
  const minutes = Math.max(0, Math.floor((new Date(clockOut) - new Date(clockIn)) / 60000));
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

async function loadTeacherTimeLog() {
  const { data: openLogs, error: openLogsError } = await state.client
    .from("teacher_time_logs")
    .select("work_date,clock_in,clock_out")
    .eq("teacher_user_id", state.user.id)
    .is("clock_out", null)
    .order("work_date", { ascending: false })
    .limit(1);
  if (openLogsError) throw openLogsError;

  if (openLogs?.length) {
    state.teacherTimeLog = openLogs[0];
  } else {
    const { data, error } = await state.client
      .from("teacher_time_logs")
      .select("work_date,clock_in,clock_out")
      .eq("teacher_user_id", state.user.id)
      .eq("work_date", schoolDate())
      .maybeSingle();
    if (error) throw error;
    state.teacherTimeLog = data;
  }
  renderTeacherTimeclock();
}

function renderTeacherTimeclock() {
  const log = state.teacherTimeLog;
  const action = $("#teacher-timeclock-action");
  $("#teacher-timeclock-date").textContent = formatWorkDate(schoolDate());

  if (!log) {
    $("#teacher-timeclock-status").textContent = "You have not clocked in for today.";
    action.textContent = "Clock in";
    action.disabled = false;
    return;
  }

  const started = `Clocked in ${formatClockTime(log.clock_in)} on ${formatWorkDate(log.work_date)}`;
  if (!log.clock_out) {
    $("#teacher-timeclock-status").textContent = `${started}. Your work session is in progress.`;
    action.textContent = "Clock out";
    action.disabled = false;
    return;
  }

  $("#teacher-timeclock-status").textContent =
    `${started}; clocked out ${formatClockTime(log.clock_out)}. Total: ${formatWorkedTime(log.clock_in, log.clock_out)}.`;
  action.textContent = "Workday complete";
  action.disabled = true;
}

async function loadTeacherTimeRecords() {
  const { data: records, error } = await state.client
    .from("teacher_time_logs")
    .select("teacher_user_id,work_date,clock_in,clock_out")
    .order("work_date", { ascending: false })
    .order("clock_in", { ascending: false })
    .limit(50);
  if (error) throw error;

  const teacherIds = [...new Set((records || []).map((record) => record.teacher_user_id))];
  let namesById = new Map();
  if (teacherIds.length) {
    const { data: teachers, error: teachersError } = await state.client
      .from("profiles")
      .select("user_id,full_name")
      .in("user_id", teacherIds);
    if (teachersError) throw teachersError;
    namesById = new Map((teachers || []).map((teacher) => [teacher.user_id, teacher.full_name]));
  }
  state.teacherTimeRecords = (records || []).map((record) => ({
    ...record,
    teacherName: namesById.get(record.teacher_user_id) || "Teacher account"
  }));
  renderTeacherTimeRecords();
}

function renderTeacherTimeRecords() {
  const records = state.teacherTimeRecords;
  $("#teacher-time-empty").hidden = records.length > 0;
  $("#teacher-time-rows").hidden = records.length === 0;
  $("#teacher-time-rows").innerHTML = records.map((record) => `
    <tr>
      <td>${escapeHtml(record.teacherName)}</td>
      <td>${escapeHtml(formatWorkDate(record.work_date))}</td>
      <td>${escapeHtml(formatClockTime(record.clock_in))}</td>
      <td>${record.clock_out ? escapeHtml(formatClockTime(record.clock_out)) : "In progress"}</td>
      <td>${record.clock_out ? escapeHtml(formatWorkedTime(record.clock_in, record.clock_out)) : "—"}</td>
    </tr>
  `).join("");
}

function shiftDate(date, offset) {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + offset);
  return shifted.toISOString().slice(0, 10);
}

function getDateRange(period, date) {
  if (period === "day") return { from: date, to: date };
  if (period === "week") return { from: shiftDate(date, -6), to: date };
  return { from: `${date.slice(0, 7)}-01`, to: date };
}

async function fetchAttendanceRange(from, to) {
  let sessionsQuery = state.client
    .from("attendance_sessions")
    .select("id,class_id,attendance_date,subject")
    .gte("attendance_date", from)
    .lte("attendance_date", to)
    .order("attendance_date");
  if (classFilter.value !== "all") sessionsQuery = sessionsQuery.eq("class_id", classFilter.value);
  const { data: sessions, error: sessionsError } = await sessionsQuery;
  if (sessionsError) throw sessionsError;
  if (!sessions?.length) return [];

  const { data: attendance, error: attendanceError } = await state.client
    .from("attendance_records")
    .select("session_id,student_id,status,absence_reason")
    .in("session_id", sessions.map((session) => session.id));
  if (attendanceError) throw attendanceError;
  if (!attendance?.length) return [];

  const studentIds = [...new Set(attendance.map((record) => record.student_id))];
  const { data: students, error: studentsError } = await state.client
    .from("students")
    .select("id,student_code,full_name,class_id,parent_phone,classes(name)")
    .in("id", studentIds);
  if (studentsError) throw studentsError;
  const studentsById = new Map((students || []).map((student) => [student.id, student]));
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));

  return attendance.flatMap((record) => {
    const student = studentsById.get(record.student_id);
    const session = sessionsById.get(record.session_id);
    if (!student || !session) return [];
    return [{
      ...student,
      className: student.classes?.name || "Unassigned",
      attendance_date: session.attendance_date,
      subject: session.subject,
      status: record.status,
      absence_reason: record.absence_reason
    }];
  });
}

function renderAttendanceReport(records, range) {
  const selectedStudent = $("#report-student").value;
  const filtered = selectedStudent === "all"
    ? records
    : records.filter((record) => record.id === selectedStudent);
  const byStudent = new Map();
  filtered.forEach((record) => {
    let summary = byStudent.get(record.id);
    if (!summary) {
      summary = {
        id: record.id,
        name: record.full_name,
        className: record.className,
        present: 0,
        absent: 0,
        late: 0,
        excused: 0
      };
      byStudent.set(record.id, summary);
    }
    if (Object.prototype.hasOwnProperty.call(summary, record.status)) summary[record.status] += 1;
  });

  state.reportRows = [...byStudent.values()].map((summary) => {
    const countableDays = summary.present + summary.absent + summary.late;
    return {
      ...summary,
      percentage: countableDays ? Math.round((summary.present + summary.late) / countableDays * 100) : 0
    };
  }).sort((left, right) => left.name.localeCompare(right.name));

  const totalEntries = filtered.length;
  $("#report-summary").textContent =
    `${range.from} to ${range.to} · ${state.reportRows.length} students · ${totalEntries} attendance records. Excused days are excluded from attendance percentage.`;
  $("#report-empty").hidden = state.reportRows.length > 0;
  $("#report-rows").hidden = state.reportRows.length === 0;
  $("#report-rows").innerHTML = state.reportRows.map((row) => `
    <tr>
      <td>${escapeHtml(row.name)}</td>
      <td>${escapeHtml(row.className)}</td>
      <td>${row.present}</td>
      <td>${row.absent}</td>
      <td>${row.late}</td>
      <td>${row.excused}</td>
      <td>${row.percentage}%</td>
    </tr>
  `).join("");
}

function renderAttendanceTrend(records, period) {
  const todayDate = schoolDate();
  const from = period === "week"
    ? shiftDate(todayDate, -6)
    : `${todayDate.slice(0, 7)}-01`;
  const buckets = new Map();
  records.forEach((record) => {
    const bucket = buckets.get(record.attendance_date) || { present: 0, late: 0, absent: 0 };
    if (["present", "late", "absent"].includes(record.status)) bucket[record.status] += 1;
    buckets.set(record.attendance_date, bucket);
  });

  const days = [];
  for (let date = from; date <= todayDate; date = shiftDate(date, 1)) days.push(date);
  $("#trend-description").textContent =
    period === "week" ? "Attendance percentage for the last seven days." : "Attendance percentage this month.";
  $("#trend-chart").setAttribute("aria-label", `Attendance percentages from ${from} through ${todayDate}`);
  $("#trend-chart").innerHTML = days.map((date) => {
    const bucket = buckets.get(date) || { present: 0, late: 0, absent: 0 };
    const total = bucket.present + bucket.late + bucket.absent;
    const percentage = total ? Math.round((bucket.present + bucket.late) / total * 100) : 0;
    const label = date.slice(5);
    return `<div class="trend-day" title="${date}: ${percentage}%">
      <div class="trend-bar-wrap"><div class="trend-bar" style="height:${percentage}%"></div></div>
      <span>${label}</span>
    </div>`;
  }).join("");
}

function contactActions(student) {
  const phone = String(student.parent_phone || "").trim();
  if (!/^[+0-9()\-\s]{6,30}$/.test(phone)) return '<span class="follow-up-empty">No parent phone</span>';
  const normalized = phone.replace(/[^\d+]/g, "");
  return `<span><a href="tel:${normalized}" aria-label="Call parent of ${escapeHtml(student.full_name)}">Call</a> · <a href="sms:${normalized}" aria-label="Text parent of ${escapeHtml(student.full_name)}">SMS</a></span>`;
}

function renderAbsenceFollowUp(records) {
  const todayRecords = records.filter((record) =>
    record.attendance_date === schoolDate() && record.status === "absent"
  );
  const absentStudents = new Map();
  todayRecords.forEach((record) => absentStudents.set(record.id, record));

  const byStudent = new Map();
  records.forEach((record) => {
    const list = byStudent.get(record.id) || [];
    list.push(record);
    byStudent.set(record.id, list);
  });
  const streaks = [];
  byStudent.forEach((studentRecords) => {
    studentRecords.sort((left, right) => right.attendance_date.localeCompare(left.attendance_date));
    let days = 0;
    for (const record of studentRecords) {
      if (record.status !== "absent") break;
      days += 1;
    }
    if (days >= 3) streaks.push({ student: studentRecords[0], days });
  });

  const toItem = (student, detail) =>
    `<li><span>${escapeHtml(student.full_name)} <small>· ${escapeHtml(detail)}</small></span>${contactActions(student)}</li>`;
  $("#absent-today-list").innerHTML = todayRecords.length
    ? [...absentStudents.values()].map((student) => toItem(student, student.className)).join("")
    : '<li class="follow-up-empty">No students are marked absent today.</li>';
  $("#absent-streak-list").innerHTML = streaks.length
    ? streaks.map(({ student, days }) => toItem(student, `${student.className} · ${days} school days`)).join("")
    : '<li class="follow-up-empty">No students absent for 3 consecutive recorded school days.</li>';
}

async function refreshAttendanceInsights() {
  if (!state.client || !state.profile) return;
  const reportDate = $("#report-date").value || schoolDate();
  const reportRange = getDateRange($("#report-period").value, reportDate);
  const trendPeriod = $("#trend-period").value;
  const trendDate = schoolDate();
  const trendRange = getDateRange(trendPeriod, trendDate);
  const followUpRange = { from: shiftDate(trendDate, -34), to: trendDate };
  const [reportRecords, trendRecords, followUpRecords] = await Promise.all([
    fetchAttendanceRange(reportRange.from, reportRange.to),
    fetchAttendanceRange(trendRange.from, trendRange.to),
    fetchAttendanceRange(followUpRange.from, followUpRange.to)
  ]);
  state.attendanceHistory = followUpRecords;
  renderAttendanceReport(reportRecords, reportRange);
  renderAttendanceTrend(trendRecords, trendPeriod);
  renderAbsenceFollowUp(followUpRecords);
}

async function refreshAttendanceInsightsSafely() {
  try {
    await refreshAttendanceInsights();
  } catch (error) {
    handleError("Could not refresh attendance reports.", error);
  }
}

$("#teacher-timeclock-action").addEventListener("click", async () => {
  const action = $("#teacher-timeclock-action");
  action.disabled = true;
  try {
    const rpc = state.teacherTimeLog && !state.teacherTimeLog.clock_out ? "teacher_clock_out" : "teacher_clock_in";
    const { error } = await state.client.rpc(rpc);
    if (error) throw error;
    await loadTeacherTimeLog();
    showToast(rpc === "teacher_clock_in" ? "Clock-in time recorded." : "Clock-out time recorded.");
  } catch (error) {
    handleError("Could not record your work time.", error);
    action.disabled = false;
  }
});

function filteredStudents() {
  const query = searchInput.value.trim().toLocaleLowerCase();
  return state.students.filter((student) => {
    const status = getStudentStatus(student.id);
    const matchesClass = classFilter.value === "all" || student.class_id === classFilter.value;
    const matchesStatus = state.statusFilter === "all" || status === state.statusFilter;
    const matchesQuery = !query || `${student.full_name} ${student.student_code} ${student.className}`.toLocaleLowerCase().includes(query);
    return matchesClass && matchesStatus && matchesQuery;
  });
}

function render() {
  const total = state.students.length;
  const counts = { present: 0, absent: 0, late: 0, excused: 0 };
  state.students.forEach((student) => {
    const status = state.attendance.get(student.id)?.status;
    if (Object.prototype.hasOwnProperty.call(counts, status)) counts[status] += 1;
  });
  $("#total-count").textContent = total;
  $("#present-count").textContent = counts.present;
  $("#absent-count").textContent = counts.absent;
  $("#late-count").textContent = counts.late;
  $("#excused-count").textContent = counts.excused;
  $("#present-detail").textContent = `${percentage(counts.present, total)}% of students`;
  $("#absent-detail").textContent = `${percentage(counts.absent, total)}% of students`;
  $("#late-detail").textContent = `${percentage(counts.late, total)}% of students`;

  const visible = filteredStudents();
  const classStudents = state.students.filter((student) => classFilter.value === "all" || student.class_id === classFilter.value);
  $("#roster-count").textContent = `${classStudents.length} ${classStudents.length === 1 ? "student" : "students"}`;
  $("#all-tab-count").textContent = classStudents.length;
  $("#showing-count").textContent = `Showing ${visible.length} of ${classStudents.length} ${classStudents.length === 1 ? "student" : "students"}`;
  $("#empty-state").hidden = visible.length > 0;
  rows.hidden = visible.length === 0;
  rows.innerHTML = visible.map(renderStudent).join("");
  updateSaveAttendanceButton();
  renderAuditEvents();
}

function percentage(value, total) {
  return total ? Math.round((value / total) * 100) : 0;
}

function renderStudent(student) {
  const attendance = state.attendance.get(student.id);
  const status = getStudentStatus(student.id);
  const reason = state.reasons.get(student.id);
  const colors = colorSets[state.students.indexOf(student) % colorSets.length];
  const name = escapeHtml(student.full_name);
  const studentId = escapeHtml(student.student_code);
  const className = escapeHtml(student.className);
  const isStaff = state.profile.role === "admin" || state.profile.role === "teacher";
  const canMark = isStaff && classFilter.value !== "all";
  const choices = [
    ["present", "Present", "M5 12l4 4L19 6"],
    ["absent", "Absent", "M7 7l10 10M17 7 7 17"],
    ["late", "Late", "M12 7v5l3 2"],
    ["excused", "Excused", "M5 12l4 4L19 6"]
  ];
  const buttons = canMark ? choices.map(([value, label, icon]) =>
    `<button type="button" class="attendance-choice${status === value ? " selected" : ""}" data-student-id="${escapeHtml(student.id)}" data-status="${value}" aria-pressed="${status === value}" aria-label="Mark ${name} ${label.toLowerCase()}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icon}"/></svg>${label}</button>`
  ).join("") : `<span class="status-text status-${status}">${escapeHtml(status === "unmarked" ? (isStaff ? "Select a class to mark" : "Not marked") : status)}</span>`;
  const absenceReason = state.pendingAbsenceReasons.get(student.id) || attendance?.absence_reason || "No reason";
  const reasonSelect = canMark && status === "absent"
    ? `<select class="absence-reason-select" data-absence-reason="${escapeHtml(student.id)}" aria-label="Absence reason for ${name}"><option${absenceReason === "Sick" ? " selected" : ""}>Sick</option><option${absenceReason === "Fees" ? " selected" : ""}>Fees</option><option${absenceReason === "Family" ? " selected" : ""}>Family</option><option${absenceReason === "No reason" ? " selected" : ""}>No reason</option></select>`
    : "";
  const statusMeta = reason
    ? `<button type="button" class="reason-link" data-reason-id="${escapeHtml(student.id)}">Reason submitted</button>`
    : status === "absent"
      ? `Absent · ${escapeHtml(absenceReason)}`
      : status === "unmarked" ? "Not marked yet" : `Marked ${escapeHtml(status)}`;
  const contactLinks = ["admin", "teacher"].includes(state.profile.role) && status === "absent"
    ? renderContactLinks(student)
    : "—";
  const actions = state.profile.role === "admin"
    ? `<div class="student-row-actions"><button type="button" data-edit-student="${escapeHtml(student.id)}">Edit</button><button type="button" data-delete-student="${escapeHtml(student.id)}">Delete</button></div>`
    : reason ? `<button type="button" class="row-menu" data-reason-id="${escapeHtml(student.id)}" aria-label="View absence reason for ${name}" title="View absence reason">View</button>` : "—";
  return `<tr>
    <td><div class="student-cell"><div class="avatar" style="background:${colors[0]};color:${colors[1]}">${escapeHtml(initials(student.full_name))}</div><div><span class="student-name">${name}</span><span class="student-meta">${statusMeta}</span></div></div></td>
    <td class="student-id">${studentId}</td>
    <td>${escapeHtml(student.gender || "—")}</td>
    <td><span class="class-chip">${className}</span></td>
    <td><div class="attendance-actions">${buttons}</div>${reasonSelect}</td>
    <td>${contactLinks}</td>
    <td>${actions}</td>
  </tr>`;
}

function renderContactLinks(student) {
  const rawPhone = String(student.parent_phone || "").trim();
  if (!/^[+0-9()\-\s]{6,30}$/.test(rawPhone)) return '<span class="contact-empty">No contact details</span>';
  const phone = rawPhone.replace(/[^\d+]/g, "");
  return `<div class="contact-links"><a class="contact-action" href="tel:${phone}" aria-label="Call parent of ${escapeHtml(student.full_name)}">Call</a><a class="contact-action" href="sms:${phone}" aria-label="Text parent of ${escapeHtml(student.full_name)}">SMS</a></div>`;
}

function renderAuditEvents() {
  const list = $("#activity-list");
  if (!state.profile || state.profile.role !== "admin") return;
  if (!state.auditEvents.length) {
    list.innerHTML = '<p class="activity-empty">No attendance changes have been recorded yet.</p>';
    return;
  }
  list.innerHTML = state.auditEvents.map((event) => {
    const student = state.students.find((item) => item.id === event.student_id);
    const action = {
      attendance_marked: "Attendance marked",
      attendance_changed: "Attendance changed",
      attendance_removed: "Attendance record removed",
      absence_reason_submitted: "Absence reason submitted",
      absence_reason_updated: "Absence reason updated"
    }[event.event_type] || "School record updated";
    const name = student ? escapeHtml(student.full_name) : "A student record";
    const actor = escapeHtml(state.auditActors.get(event.actor_id) || "School account");
    const when = new Date(event.created_at).toLocaleString();
    return `<div class="activity-item"><span class="activity-dot"></span><span><strong>${action}</strong><small>${name} · ${escapeHtml(event.attendance_date || "")} · by ${actor}</small></span><time>${escapeHtml(when)}</time></div>`;
  }).join("");
}

function renderReasonForm() {
  const studentId = $("#reason-student").value || (state.profile.role === "student" ? state.profile.student_id : "");
  const date = $("#reason-date").value;
  const attendance = state.attendance.get(studentId);
  const reason = state.reasons.get(studentId);
  const textarea = $("#absence-reason");
  const submitButton = $("#submit-reason-button");
  const message = $("#reason-message");
  $("#existing-reason").hidden = true;
  textarea.value = "";
  textarea.disabled = false;
  submitButton.disabled = false;
  submitButton.textContent = "Submit reason";
  if (!state.students.length) {
    message.textContent = "No student account is linked yet. Contact the school administrator.";
    submitButton.disabled = true;
  } else if (!attendance || attendance.status !== "absent") {
    message.textContent = "A reason can be submitted after the school records the student as absent for this date.";
    submitButton.disabled = true;
  } else if (reason) {
    textarea.value = reason.reason;
    if (reason.submitted_by !== state.user.id) {
      textarea.disabled = true;
      submitButton.disabled = true;
      $("#existing-reason").textContent = "A reason has already been submitted for this absence.";
      $("#existing-reason").hidden = false;
      message.textContent = "";
    } else {
      submitButton.textContent = "Update reason";
      message.textContent = "You can update the reason you submitted.";
    }
  } else {
    submitButton.textContent = "Submit reason";
    message.textContent = "";
  }
}

function renderReasonDetails(studentId) {
  const student = state.students.find((item) => item.id === studentId);
  const reason = state.reasons.get(studentId);
  if (!student || !reason) return;
  $("#reason-detail-title").textContent = `Absence reason · ${student.full_name}`;
  $("#reason-detail-date").textContent = reason.attendance_date;
  $("#reason-detail-body").textContent = reason.reason;
  $("#reason-detail-dialog").showModal();
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.client) return;
  loginSubmit.disabled = true;
  loginSubmit.textContent = "Signing in…";
  setAuthMessage("", false);
  const { data, error } = await state.client.auth.signInWithPassword({
    email: $("#login-email").value.trim(),
    password: $("#login-password").value
  });
  if (error) {
    setAuthMessage(error.message);
    loginSubmit.disabled = false;
    loginSubmit.textContent = "Sign in";
    return;
  }
  await openSession(data.user);
  loginSubmit.disabled = false;
  loginSubmit.textContent = "Sign in";
});

async function signOut() {
  if (!state.client) return;
  const { error } = await state.client.auth.signOut();
  if (error) {
    handleError("Could not sign out.", error);
    return;
  }
  closeSession();
  setAuthMessage("You have been signed out.", false);
}

$("#logout-button").addEventListener("click", signOut);
$("#top-logout-button").addEventListener("click", signOut);

dateInput.addEventListener("change", async () => {
  $("#reason-date").value = dateInput.value;
  try {
    await loadDayData();
    render();
    await refreshAttendanceInsights();
  } catch (error) {
    handleError("Could not load attendance for this date.", error);
  }
});
classFilter.addEventListener("change", async () => {
  saveFilters();
  try {
    await loadDayData();
    render();
    await refreshAttendanceInsights();
  } catch (error) {
    handleError("Could not load attendance for this class.", error);
  }
});
$("#attendance-subject").addEventListener("change", updateSaveAttendanceButton);
$("#report-period").addEventListener("change", refreshAttendanceInsightsSafely);
$("#report-date").addEventListener("change", refreshAttendanceInsightsSafely);
$("#report-student").addEventListener("change", refreshAttendanceInsightsSafely);
$("#trend-period").addEventListener("change", refreshAttendanceInsightsSafely);
searchInput.addEventListener("input", render);

document.querySelectorAll(".filter-tab").forEach((button) => {
  button.addEventListener("click", () => {
    state.statusFilter = button.dataset.statusFilter;
    document.querySelectorAll(".filter-tab").forEach((tab) => {
      const selected = tab === button;
      tab.classList.toggle("active", selected);
      tab.setAttribute("aria-selected", String(selected));
    });
    render();
  });
});

rows.addEventListener("click", (event) => {
  const statusButton = event.target.closest("[data-student-id][data-status]");
  if (statusButton) {
    setAttendance(statusButton.dataset.studentId, statusButton.dataset.status);
    return;
  }
  const editButton = event.target.closest("[data-edit-student]");
  if (editButton) {
    editStudent(editButton.dataset.editStudent);
    return;
  }
  const deleteButton = event.target.closest("[data-delete-student]");
  if (deleteButton) {
    archiveStudent(deleteButton.dataset.deleteStudent);
    return;
  }
  const reasonButton = event.target.closest("[data-reason-id]");
  if (reasonButton) renderReasonDetails(reasonButton.dataset.reasonId);
});

rows.addEventListener("change", (event) => {
  const reasonSelect = event.target.closest("[data-absence-reason]");
  if (reasonSelect) {
    state.pendingAbsenceReasons.set(reasonSelect.dataset.absenceReason, reasonSelect.value);
    updateSaveAttendanceButton();
  }
});

function setAttendance(studentId, status) {
  if (!["present", "absent", "late", "excused"].includes(status)) return;
  state.pendingAttendance.set(studentId, status);
  if (status !== "absent") state.pendingAbsenceReasons.delete(studentId);
  else if (!state.pendingAbsenceReasons.has(studentId)) state.pendingAbsenceReasons.set(studentId, "No reason");
  render();
}

$("#save-attendance-button").addEventListener("click", async () => {
  const classId = classFilter.value;
  const students = getSelectedClassStudents();
  const subject = $("#attendance-subject").value.trim();
  if (classId === "all" || !subject) {
    showToast("Choose a class and subject before saving.");
    return;
  }
  if (students.some((student) => !["present", "absent", "late", "excused"].includes(getStudentStatus(student.id)))) {
    showToast("Mark every student before saving attendance.");
    return;
  }

  const button = $("#save-attendance-button");
  button.disabled = true;
  try {
    const records = students.map((student) => ({
      student_id: student.id,
      status: getStudentStatus(student.id),
      absence_reason: getStudentStatus(student.id) === "absent"
        ? state.pendingAbsenceReasons.get(student.id) || "No reason"
        : null
    }));
    const { error } = await state.client.rpc("save_attendance_session", {
      target_class_id: classId,
      target_date: dateInput.value,
      target_subject: subject,
      records
    });
    if (error) throw error;
    await loadDayData();
    if (state.profile.role === "admin") await loadAuditEvents();
    render();
    await refreshAttendanceInsights();
    showToast("Attendance saved.");
  } catch (error) {
    handleError("Could not save attendance.", error);
    updateSaveAttendanceButton();
  }
});

$("#mark-all-button").addEventListener("click", () => {
  if (classFilter.value === "all") {
    showToast("Choose one class before marking attendance.");
    return;
  }
  const students = getSelectedClassStudents();
  if (!students.length) {
    showToast("There are no students in this view to mark.");
    return;
  }
  students.forEach((student) => state.pendingAttendance.set(student.id, "present"));
  render();
});

$("#add-student-button").addEventListener("click", () => {
  $("#student-form").reset();
  $("#student-edit-id").value = "";
  $("#student-form-title").textContent = "Add a student";
  $("#student-form-submit").textContent = "Add student";
  if (!state.classes.length) {
    showToast("Create a class before adding students.");
    return;
  }
  $("#student-class").value = classFilter.value === "all" ? state.classes[0].id : classFilter.value;
  $("#student-dialog").showModal();
  $("#student-name").focus();
});

function editStudent(studentId) {
  const student = state.students.find((item) => item.id === studentId);
  if (!student) return;
  $("#student-form").reset();
  $("#student-edit-id").value = student.id;
  $("#student-name").value = student.full_name;
  $("#student-class").value = student.class_id;
  $("#student-id").value = student.student_code;
  $("#student-gender").value = student.gender || "";
  $("#student-parent-phone").value = student.parent_phone || "";
  $("#student-form-title").textContent = "Edit student";
  $("#student-form-submit").textContent = "Save changes";
  $("#student-dialog").showModal();
  $("#student-name").focus();
}

async function archiveStudent(studentId) {
  const student = state.students.find((item) => item.id === studentId);
  if (!student || !window.confirm(`Remove ${student.full_name} from the active student list? Past attendance will be kept.`)) return;
  const { error } = await state.client
    .from("students")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", studentId);
  if (error) {
    handleError("Could not remove the student.", error);
    return;
  }
  await loadDashboard();
  showToast(`${student.full_name} was removed from the active list.`);
}

$("#close-dialog").addEventListener("click", () => $("#student-dialog").close());
$("#cancel-dialog").addEventListener("click", () => $("#student-dialog").close());
$("#student-dialog").addEventListener("click", (event) => {
  if (event.target === $("#student-dialog")) $("#student-dialog").close();
});
$("#student-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const student = {
    full_name: $("#student-name").value.trim(),
    class_id: $("#student-class").value,
    student_code: $("#student-id").value.trim(),
    gender: $("#student-gender").value || null,
    parent_phone: $("#student-parent-phone").value.trim() || null,
    updated_at: new Date().toISOString()
  };
  if (!student.full_name || !student.class_id || !student.student_code) return;
  const studentId = $("#student-edit-id").value;
  const { error } = studentId
    ? await state.client.from("students").update(student).eq("id", studentId)
    : await state.client.from("students").insert(student);
  if (error) {
    handleError(studentId ? "Could not update the student." : "Could not add student.", error);
    return;
  }
  $("#student-dialog").close();
  await loadDashboard();
  showToast(studentId ? `${student.full_name} updated.` : `${student.full_name} added to the roster.`);
});

$("#add-class-button").addEventListener("click", () => {
  $("#class-form").reset();
  $("#class-edit-target").value = "";
  $("#class-form-title").textContent = "Add a class";
  $("#class-form-submit").textContent = "Add class";
  $("#class-dialog").showModal();
  $("#class-name").focus();
});
$("#manage-class-button").addEventListener("click", () => {
  $("#class-form").reset();
  $("#class-edit-target").value = "";
  $("#class-form-title").textContent = "Manage classes";
  $("#class-form-submit").textContent = "Create class";
  $("#class-dialog").showModal();
  $("#class-edit-target").focus();
});
$("#class-edit-target").addEventListener("change", () => {
  const classItem = state.classes.find((item) => item.id === $("#class-edit-target").value);
  if (!classItem) {
    $("#class-name").value = "";
    $("#class-teacher").value = "";
    $("#class-form-title").textContent = "Add a class";
    $("#class-form-submit").textContent = "Add class";
    return;
  }
  $("#class-name").value = classItem.name;
  $("#class-teacher").value = classItem.teacher_id || "";
  $("#class-form-title").textContent = "Edit class";
  $("#class-form-submit").textContent = "Save changes";
});
$("#close-class-dialog").addEventListener("click", () => $("#class-dialog").close());
$("#cancel-class-dialog").addEventListener("click", () => $("#class-dialog").close());
$("#class-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = $("#class-name").value.trim();
  if (!name) return;
  const teacherId = $("#class-teacher").value || null;
  const classId = $("#class-edit-target").value;
  const { error } = classId
    ? await state.client.from("classes").update({ name, teacher_id: teacherId }).eq("id", classId)
    : await state.client.from("classes").insert({ name, teacher_id: teacherId });
  if (error) {
    handleError(classId ? "Could not update the class." : "Could not add class.", error);
    return;
  }
  $("#class-dialog").close();
  await loadDashboard();
  showToast(classId ? `${name} updated.` : `${name} added.`);
});

$("#reason-student").addEventListener("change", renderReasonForm);
$("#reason-date").addEventListener("change", async () => {
  dateInput.value = $("#reason-date").value;
  try {
    await loadDayData();
    renderReasonForm();
    render();
  } catch (error) {
    handleError("Could not check this absence.", error);
  }
});
$("#reason-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const studentId = $("#reason-student").value || state.profile.student_id;
  const reason = $("#absence-reason").value.trim();
  const attendance = state.attendance.get(studentId);
  if (!attendance || attendance.status !== "absent" || !reason) {
    $("#reason-message").textContent = "The student must be marked absent, and a reason is required.";
    return;
  }
  const { error } = await state.client.from("absence_reasons").upsert({
    student_id: studentId,
    attendance_date: $("#reason-date").value,
    submitted_by: state.user.id,
    reason
  }, { onConflict: "student_id,attendance_date" });
  if (error) {
    handleError("Could not submit the absence reason.", error);
    return;
  }
  await loadDayData();
  render();
  showToast("Absence reason submitted privately.");
});

$("#close-reason-dialog").addEventListener("click", () => $("#reason-detail-dialog").close());
$("#reason-detail-dialog").addEventListener("click", (event) => {
  if (event.target === $("#reason-detail-dialog")) $("#reason-detail-dialog").close();
});

$("#export-button").addEventListener("click", () => {
  const students = filteredStudents();
  const escapeCsv = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const lines = [
    ["Date", "Subject", "Admission No.", "Student Name", "Gender", "Class", "Attendance", "Absence reason"],
    ...students.map((student) => [
      dateInput.value,
      $("#attendance-subject").value.trim(),
      student.student_code,
      student.full_name,
      student.gender || "",
      student.className,
      state.attendance.get(student.id)?.status || "unmarked",
      state.attendance.get(student.id)?.absence_reason || ""
    ])
  ];
  const csv = lines.map((line) => line.map(escapeCsv).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `ke259-attendance-${dateInput.value}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
});

function reportFileName(extension) {
  const date = $("#report-date").value || schoolDate();
  return `ke259-attendance-report-${date}.${extension}`;
}

function downloadReportFile(content, type, filename) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

$("#report-csv").addEventListener("click", () => {
  const csvEscape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const lines = [
    ["Student", "Class", "Present", "Absent", "Late", "Excused", "Attendance %"],
    ...state.reportRows.map((row) => [
      row.name, row.className, row.present, row.absent, row.late, row.excused, row.percentage
    ])
  ];
  const csv = lines.map((line) => line.map(csvEscape).join(",")).join("\r\n");
  downloadReportFile(`\uFEFF${csv}`, "text/csv;charset=utf-8", reportFileName("csv"));
});

$("#report-excel").addEventListener("click", () => {
  const table = $("#report-panel table").outerHTML;
  const workbook = `<!doctype html><html><head><meta charset="utf-8"></head><body>${table}</body></html>`;
  downloadReportFile(workbook, "application/vnd.ms-excel;charset=utf-8", reportFileName("xls"));
});

$("#report-pdf").addEventListener("click", () => window.print());

document.addEventListener("keydown", (event) => {
  if (event.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName) && !$("#student-dialog").open && !$("#class-dialog").open && !$("#reason-detail-dialog").open) {
    event.preventDefault();
    searchInput.focus();
  }
});
