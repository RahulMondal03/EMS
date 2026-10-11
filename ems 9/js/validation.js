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


/* ============================================================
   InputValidator — a reusable class for the same job, with a
   chainable style that reads like a sentence. It reuses the
   checks and error helpers in V above, and adds the ones the
   pages were doing by hand (max length, number ranges, whole
   numbers, "must match another field", dates, custom rules).

   Example:
     const ok = new InputValidator()
       .field("units").required("Enter the units consumed")
                      .number("Units must be a number")
                      .min(0, "Units cannot be negative")
       .field("confirm").matches("password", "Passwords do not match")
       .validate();

   Like V.validate, only the first failing message per field is
   shown, and validate() returns true when every field passes.
   ============================================================ */

class InputValidator {
  constructor() {
    this.rules = [];          // [{ id, checks: [[testFn, message], ...] }]
    this.current = null;      // the rule that new checks are added to
  }

  /* Start a new field. Every check after this applies to it. */
  field(id) {
    this.current = { id, checks: [] };
    this.rules.push(this.current);
    return this;
  }

  /* Add any test function (value => true when valid). */
  check(test, message) {
    if (!this.current) throw new Error("InputValidator: call field(id) before adding checks");
    this.current.checks.push([test, message]);
    return this;
  }

  /* ---------- Text ---------- */
  required(message = "This field is required")    { return this.check(V.required, message); }
  email(message = "Enter a valid email")           { return this.check(V.email, message); }
  phone(message = "Enter a valid 10-digit mobile") { return this.check(V.phone, message); }
  minLength(n, message = `Use at least ${n} characters`) { return this.check(V.minLen(n), message); }
  maxLength(n, message = `Keep it to ${n} characters or fewer`) {
    return this.check((v) => v.trim().length <= n, message);
  }
  pattern(regex, message = "Enter a valid value") { return this.check((v) => regex.test(v.trim()), message); }

  /* ---------- Numbers ---------- */
  number(message = "Must be a number")              { return this.check(V.number, message); }
  positive(message = "Must be a positive number")   { return this.check(V.positive, message); }
  integer(message = "Must be a whole number") {
    return this.check((v) => V.number(v) && Number.isInteger(Number(v)), message);
  }
  min(n, message = `Must be at least ${n}`)  { return this.check((v) => V.number(v) && Number(v) >= n, message); }
  max(n, message = `Must be at most ${n}`)   { return this.check((v) => V.number(v) && Number(v) <= n, message); }
  between(lo, hi, message = `Must be between ${lo} and ${hi}`) {
    return this.check((v) => V.number(v) && Number(v) >= lo && Number(v) <= hi, message);
  }

  /* ---------- Payment ---------- */
  cardNumber(message = "Enter a valid 16-digit card number") { return this.check(V.cardNumber, message); }
  cvv(message = "Enter the 3-digit CVV")                     { return this.check(V.cvv, message); }
  expiry(message = "Enter a future expiry as MM/YY")         { return this.check(V.expiry, message); }
  upiId(message = "Enter a valid UPI ID")                    { return this.check(V.upiId, message); }

  /* ---------- Cross-field and dates ---------- */
  /* Value must equal another input's value (e.g. confirm password). */
  matches(otherId, message = "Values do not match") {
    return this.check((v) => {
      const other = document.getElementById(otherId);
      return !!other && v.trim() === other.value.trim();
    }, message);
  }

  /* A date input (YYYY-MM-DD) that is today or later. */
  notPastDate(message = "Date cannot be in the past") {
    return this.check((v) => {
      const d = new Date(v.trim() + "T00:00:00");
      if (isNaN(d)) return false;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return d >= today;
    }, message);
  }

  /* ---------- Running it ---------- */
  /* Show errors on the page; true when every field passes. */
  validate() { return V.validate(this.rules); }

  /* Clear each field's error as the user types. */
  liveClear() {
    V.liveClear(this.rules.map((r) => r.id));
    return this;
  }
}
