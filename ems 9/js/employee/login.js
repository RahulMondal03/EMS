/* employee/login.js — sign an employee in. */

document.getElementById("loginBtn").addEventListener("click", () => {
  const ok = V.validate([
    { id: "email",    checks: [[V.required, "Email is required"], [V.email, "Enter a valid email"]] },
    { id: "password", checks: [[V.required, "Password is required"]] },
  ]);
  if (!ok) return;

  const email    = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  const emp = EMS.loginEmployee(email, password);
  if (!emp) {
    const alert = document.getElementById("alert");
    alert.textContent = "No employee account matches those credentials.";
    alert.classList.add("show");
    return;
  }

  EMS.setSession("employee", emp.id, emp.name);
  location.href = "dashboard.html";
});

V.liveClear(["email", "password"]);
