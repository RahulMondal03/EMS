/* sso.js — one sign-in for both kinds of account.

   VoltGrid normally has two front doors (customer and employee). This
   single sign-on page keeps just one form: the visitor types their
   email and password once, we work out which kind of account matches,
   sign them in, and send them to the right dashboard. Staff accounts
   are checked first, then customers. */

document.getElementById("loginBtn").addEventListener("click", () => {
  const ok = V.validate([
    { id: "email",    checks: [[V.required, "Email is required"], [V.email, "Enter a valid email"]] },
    { id: "password", checks: [[V.required, "Password is required"]] },
  ]);
  if (!ok) return;

  const email    = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  /* Staff first, then customers. Emails don't overlap in the demo data,
     so at most one of these matches. */
  const emp = EMS.loginEmployee(email, password);
  if (emp) {
    EMS.setSession("employee", emp.id, emp.name);
    location.href = "employee/dashboard.html";
    return;
  }

  const customer = EMS.loginCustomer(email, password);
  if (customer) {
    EMS.setSession("customer", customer.id, customer.name);
    location.href = "customer/dashboard.html";
    return;
  }

  const alert = document.getElementById("alert");
  alert.textContent = "No account matches that email and password.";
  alert.classList.add("show");
});

V.liveClear(["email", "password"]);
