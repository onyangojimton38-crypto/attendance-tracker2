const demoStudents = [
  { name: "Sample Learner 01", code: "DEMO-001", classId: "class-east", className: "Class 1 East", status: "present" },
  { name: "Sample Learner 02", code: "DEMO-002", classId: "class-east", className: "Class 1 East", status: "absent" },
  { name: "Sample Learner 03", code: "DEMO-003", classId: "class-east", className: "Class 1 East", status: "present" },
  { name: "Sample Learner 04", code: "DEMO-004", classId: "class-west", className: "Class 2 West", status: "late" },
  { name: "Sample Learner 05", code: "DEMO-005", classId: "class-west", className: "Class 2 West", status: "unmarked" }
];

const demoQuery = new URLSearchParams(window.location.search);
const previewButton = document.querySelector("#demo-preview-button");

if (demoQuery.get("demo") === "1") {
  showDemoPreview();
} else {
  previewButton.addEventListener("click", () => {
    const url = new URL(window.location.href);
    url.searchParams.set("demo", "1");
    window.location.assign(url);
  });
}

function showDemoPreview() {
  const app = document.querySelector("#app-shell");
  const login = document.querySelector("#login-screen");
  const classFilter = document.querySelector("#class-filter");
  const search = document.querySelector("#student-search");
  const rows = document.querySelector("#student-rows");
  let statusFilter = "all";

  app.hidden = false;
  login.hidden = true;
  document.querySelector("#demo-banner").hidden = false;
  document.querySelector("#profile-name").textContent = "Demo Preview";
  document.querySelector("#profile-role").textContent = "Fictional sample data";
  document.querySelector("#profile-avatar").textContent = "DP";
  document.querySelector("#school-scope").textContent = "Sample data only";
  document.querySelector("#total-detail").textContent = "Across 2 sample classes";
  document.querySelector("#roster-description").textContent = "Fictional sample records for preview only.";
  document.querySelector("#save-note-text").textContent = "Preview only; changes are not saved";
  document.querySelector("#admin-activity").hidden = false;
  document.querySelector("#attendance-trends").hidden = false;
  document.querySelector("#absence-follow-up").hidden = false;
  document.querySelector("#report-panel").hidden = false;
  document.querySelector("#activity-list").innerHTML =
    '<p class="activity-empty">This preview contains fictional data; no real changes have been recorded.</p>';
  document.querySelector("#trend-chart").innerHTML =
    '<div class="trend-day"><div class="trend-bar-wrap"><div class="trend-bar" style="height:80%"></div></div><span>Mon</span></div><div class="trend-day"><div class="trend-bar-wrap"><div class="trend-bar" style="height:70%"></div></div><span>Tue</span></div><div class="trend-day"><div class="trend-bar-wrap"><div class="trend-bar" style="height:90%"></div></div><span>Wed</span></div><div class="trend-day"><div class="trend-bar-wrap"><div class="trend-bar" style="height:60%"></div></div><span>Thu</span></div><div class="trend-day"><div class="trend-bar-wrap"><div class="trend-bar" style="height:100%"></div></div><span>Fri</span></div>';
  document.querySelector("#absent-today-list").innerHTML =
    '<li><span>Sample Learner 02 <small>· Class 1 East</small></span><span class="follow-up-empty">No parent phone</span></li>';
  document.querySelector("#absent-streak-list").innerHTML =
    '<li class="follow-up-empty">No sample students absent for 3 consecutive recorded school days.</li>';
  document.querySelector("#report-summary").textContent = "Sample report · 5 fictional students · preview only.";
  document.querySelector("#report-empty").hidden = true;
  document.querySelector("#report-rows").innerHTML =
    '<tr><td>Sample Learner 01</td><td>Class 1 East</td><td>1</td><td>0</td><td>0</td><td>0</td><td>100%</td></tr><tr><td>Sample Learner 02</td><td>Class 1 East</td><td>0</td><td>1</td><td>0</td><td>0</td><td>0%</td></tr><tr><td>Sample Learner 03</td><td>Class 1 East</td><td>1</td><td>0</td><td>0</td><td>0</td><td>100%</td></tr><tr><td>Sample Learner 04</td><td>Class 2 West</td><td>0</td><td>0</td><td>1</td><td>0</td><td>100%</td></tr><tr><td>Sample Learner 05</td><td>Class 2 West</td><td>0</td><td>0</td><td>0</td><td>0</td><td>0%</td></tr>';
  document.querySelector("#report-period").disabled = true;
  document.querySelector("#report-date").disabled = true;
  document.querySelector("#report-student").disabled = true;
  document.querySelector("#trend-period").disabled = true;
  document.querySelectorAll("#report-panel .report-exports .button").forEach((button) => { button.hidden = true; });
  document.querySelector("#attendance-date").disabled = true;
  document.querySelector("#attendance-subject").disabled = true;
  document.querySelector("#teacher-timeclock").hidden = false;
  document.querySelector("#teacher-time-review").hidden = false;
  document.querySelector("#teacher-timeclock-status").textContent =
    "Sample Teacher 01 clocked in at 8:05 AM. This sample work session is in progress.";
  document.querySelector("#teacher-timeclock-action").textContent = "Clocked in (sample)";
  document.querySelector("#teacher-timeclock-action").disabled = true;

  ["#add-student-button", "#add-class-button", "#mark-all-button", "#save-attendance-button", "#export-button", "#logout-button", "#top-logout-button"]
    .forEach((selector) => { document.querySelector(selector).hidden = true; });

  classFilter.insertAdjacentHTML("beforeend", [
    '<option value="class-east">Class 1 East</option>',
    '<option value="class-west">Class 2 West</option>'
  ].join(""));

  const now = new Date();
  const localToday = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  document.querySelector("#attendance-date").value = localToday;
  document.querySelector("#report-date").value = localToday;
  document.querySelector("#teacher-timeclock-date").textContent = localToday;
  document.querySelector("#teacher-time-rows").innerHTML = `
    <tr><td>Sample Teacher 01</td><td>${localToday}</td><td>8:05 AM</td><td>In progress</td><td>—</td></tr>
    <tr><td>Sample Teacher 02</td><td>${localToday}</td><td>8:12 AM</td><td>4:03 PM</td><td>7h 51m</td></tr>
  `;

  function renderDemoRows() {
    const selectedClass = classFilter.value;
    const query = search.value.trim().toLocaleLowerCase();
    const classStudents = demoStudents.filter((student) =>
      selectedClass === "all" || student.classId === selectedClass
    );
    const visibleStudents = classStudents.filter((student) => {
      const matchesStatus = statusFilter === "all" || student.status === statusFilter;
      const matchesSearch = !query ||
        `${student.name} ${student.code} ${student.className}`.toLocaleLowerCase().includes(query);
      return matchesStatus && matchesSearch;
    });
    const counts = { present: 0, absent: 0, late: 0 };
    classStudents.forEach((student) => {
      if (Object.prototype.hasOwnProperty.call(counts, student.status)) counts[student.status] += 1;
    });

    document.querySelector("#total-count").textContent = classStudents.length;
    document.querySelector("#present-count").textContent = counts.present;
    document.querySelector("#absent-count").textContent = counts.absent;
    document.querySelector("#late-count").textContent = counts.late;
    document.querySelector("#present-detail").textContent =
      `${Math.round(counts.present / classStudents.length * 100) || 0}% of students`;
    document.querySelector("#absent-detail").textContent =
      `${Math.round(counts.absent / classStudents.length * 100) || 0}% of students`;
    document.querySelector("#late-detail").textContent =
      `${Math.round(counts.late / classStudents.length * 100) || 0}% of students`;
    document.querySelector("#roster-count").textContent =
      `${classStudents.length} ${classStudents.length === 1 ? "student" : "students"}`;
    document.querySelector("#all-tab-count").textContent = classStudents.length;
    document.querySelector("#showing-count").textContent =
      `Showing ${visibleStudents.length} of ${classStudents.length} ${classStudents.length === 1 ? "student" : "students"}`;
    document.querySelector("#empty-state").hidden = visibleStudents.length > 0;
    rows.hidden = visibleStudents.length === 0;
    rows.innerHTML = visibleStudents.map((student, index) => {
      const initials = student.name.split(" ").slice(0, 2).map((part) => part[0]).join("");
      const palette = [["#e6e2ff", "#6558c9"], ["#ffe9df", "#c4775a"], ["#e0f3ec", "#418b70"]][index % 3];
      return `<tr>
        <td><div class="student-cell"><div class="avatar" style="background:${palette[0]};color:${palette[1]}">${initials}</div><div><span class="student-name">${student.name}</span><span class="student-meta">${student.status === "unmarked" ? "Not marked yet" : `Marked ${student.status}`}</span></div></div></td>
        <td class="student-id">${student.code}</td>
        <td>—</td>
        <td><span class="class-chip">${student.className}</span></td>
        <td><span class="status-text status-${student.status}">${student.status === "unmarked" ? "Not marked" : student.status}</span></td>
        <td>—</td>
        <td>—</td>
      </tr>`;
    }).join("");
  }

  classFilter.addEventListener("change", renderDemoRows);
  search.addEventListener("input", renderDemoRows);
  document.querySelectorAll(".filter-tab").forEach((button) => {
    button.addEventListener("click", () => {
      statusFilter = button.dataset.statusFilter;
      document.querySelectorAll(".filter-tab").forEach((tab) => {
        const selected = tab === button;
        tab.classList.toggle("active", selected);
        tab.setAttribute("aria-selected", String(selected));
      });
      renderDemoRows();
    });
  });
  document.querySelector("#exit-demo-preview").addEventListener("click", () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("demo");
    window.location.assign(url);
  });

  renderDemoRows();
}
