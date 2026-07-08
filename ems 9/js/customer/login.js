/* customer/login.js — sign a customer in and route to the dashboard. */

document.getElementById("loginBtn").addEventListener("click", () => {
  const ok = V.validate([
    { id: "email",    checks: [[V.required, "Email is required"], [V.email, "Enter a valid email"]] },
    { id: "password", checks: [[V.required, "Password is required"]] },
  ]);
  if (!ok) return;

  const email    = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  const customer = EMS.loginCustomer(email, password);
  if (!customer) {
    const alert = document.getElementById("alert");
    alert.textContent = "No account matches that email and password.";
    alert.classList.add("show");
    return;
  }

  EMS.setSession("customer", customer.id, customer.name);
  location.href = "dashboard.html";
});

V.liveClear(["email", "password"]);
