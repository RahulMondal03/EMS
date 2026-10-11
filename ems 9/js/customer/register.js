/* customer/register.js — create a new customer account. */

document.getElementById("registerBtn").addEventListener("click", () => {
  const ok = new InputValidator()
    .field("name").required("Name is required").minLength(3, "Name looks too short")
    .field("phone").required("Mobile number is required").phone("Enter a valid 10-digit mobile number")
    .field("email").required("Email is required").email("Enter a valid email")
    .field("address").required("Service address is required")
    .field("password").required("Password is required").minLength(6, "Use at least 6 characters")
    .field("confirm").required("Please repeat your password").matches("password", "Passwords do not match")
    .validate();
  if (!ok) return;

  const alert = document.getElementById("alert");
  const val = (id) => document.getElementById(id).value.trim();

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
