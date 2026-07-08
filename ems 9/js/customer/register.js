/* customer/register.js — create a new customer account. */

document.getElementById("registerBtn").addEventListener("click", () => {
  const ok = V.validate([
    { id: "name",     checks: [[V.required, "Name is required"], [V.minLen(3), "Name looks too short"]] },
    { id: "phone",    checks: [[V.required, "Mobile number is required"], [V.phone, "Enter a valid 10-digit mobile number"]] },
    { id: "email",    checks: [[V.required, "Email is required"], [V.email, "Enter a valid email"]] },
    { id: "address",  checks: [[V.required, "Service address is required"]] },
    { id: "password", checks: [[V.required, "Password is required"], [V.minLen(6), "Use at least 6 characters"]] },
    { id: "confirm",  checks: [[V.required, "Please repeat your password"]] },
  ]);
  if (!ok) return;

  const alert = document.getElementById("alert");
  const val = (id) => document.getElementById(id).value.trim();

  /* Passwords must match. */
  if (val("password") !== val("confirm")) {
    V.setError(document.getElementById("confirm"), "Passwords do not match");
    return;
  }

  /* Emails must be unique in the store. */
  if (EMS.customerByMail(val("email"))) {
    alert.textContent = "An account with this email already exists. Try signing in.";
    alert.classList.add("show");
    return;
  }

  const customer = EMS.addCustomer({
    name: val("name"), email: val("email"), phone: val("phone"),
    address: val("address"), password: val("password"),
  });

  /* Sign the new customer in right away. */
  EMS.setSession("customer", customer.id, customer.name);
  location.href = "dashboard.html";
});

V.liveClear(["name", "phone", "email", "address", "password", "confirm"]);
