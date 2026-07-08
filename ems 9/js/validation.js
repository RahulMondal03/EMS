/* ============================================================
   validation.js — small reusable form validators.
   Each page builds a "rules" array and calls V.validate(rules).
   A rule is: { id: "input-id", checks: [ [testFn, "message"], ... ] }
   ============================================================ */

const V = (() => {

  /* ---------- Individual checks (return true when valid) ---------- */
  const required = (v) => v.trim().length > 0;
  const email    = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
  const phone    = (v) => /^[6-9]\d{9}$/.test(v.trim());          // 10-digit Indian mobile
  const minLen   = (n) => (v) => v.trim().length >= n;
  const number   = (v) => v.trim() !== "" && !isNaN(Number(v));
  const positive = (v) => number(v) && Number(v) > 0;

  /* Payment-specific checks */
  const cardNumber = (v) => /^\d{16}$/.test(v.replace(/\s/g, ""));
  const cvv        = (v) => /^\d{3}$/.test(v.trim());
  const upiId      = (v) => /^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(v.trim());

  /* Expiry must be MM/YY and in the future */
  const expiry = (v) => {
    const m = v.trim().match(/^(0[1-9]|1[0-2])\/(\d{2})$/);
    if (!m) return false;
    const exp = new Date(2000 + Number(m[2]), Number(m[1]), 0);   // last day of that month
    return exp >= new Date();
  };

  /* ---------- Field helpers ---------- */
  function setError(input, message) {
    const field = input.closest(".field");
    if (!field) return;
    field.classList.add("invalid");
    const msg = field.querySelector(".error-msg");
    if (msg) msg.textContent = message;
  }

  function clearError(input) {
    const field = input.closest(".field");
    if (field) field.classList.remove("invalid");
  }

  /* ---------- Main entry point ----------
     rules example:
       [ { id: "email", checks: [[V.required, "Email is required"],
                                 [V.email,    "Enter a valid email"]] } ]
     Returns true when every field passes.                          */
  function validate(rules) {
    let ok = true;
    rules.forEach((rule) => {
      const input = document.getElementById(rule.id);
      if (!input) return;
      clearError(input);
      for (const [test, message] of rule.checks) {
        if (!test(input.value)) {
          setError(input, message);
          ok = false;
          break;                       // show the first failing message only
        }
      }
    });
    return ok;
  }

  /* Clear errors live while the user types. */
  function liveClear(ids) {
    ids.forEach((id) => {
      const input = document.getElementById(id);
      if (input) input.addEventListener("input", () => clearError(input));
    });
  }

  return { required, email, phone, minLen, number, positive,
           cardNumber, cvv, upiId, expiry,
           validate, liveClear, setError, clearError };
})();
