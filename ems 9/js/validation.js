/* ============================================================
   validation.js — small reusable form validators.
   Each page builds a "rules" array and calls V.validate(rules).
   A rule is: { id: "input-id", checks: [ [testFn, "message"], ... ] }
   ============================================================ */

/* ------------------------------------------------------------
   isValidEmail(email) — true when the value looks like a valid
   email address ("local@domain.tld"), false otherwise.
   Accepts anything: a non-string always returns false.

   Rules applied (a practical subset of RFC 5321/5322):
     • exactly one "@", with a local part and a domain around it
     • whole address at most 254 characters
     • local part 1-64 chars of letters, digits and ! # $ % & ' * +
       / = ? ^ _ ` { | } ~ - . , with no leading, trailing or
       doubled dot
     • domain at most 253 chars, made of dot-separated labels of
       1-63 letters, digits or hyphens that never start or end
       with a hyphen
     • at least two labels, and the last one (the TLD) is 2+ letters
   Quoted local parts ("a b"@x.com), IP-literal domains and
   internationalised (non-ASCII) addresses are treated as invalid.
   ------------------------------------------------------------ */
function isValidEmail(email) {
  if (typeof email !== "string") return false;

  const value = email.trim();
  if (value.length === 0 || value.length > 254) return false;

  const at = value.lastIndexOf("@");
  if (at < 1 || at === value.length - 1) return false;

  const local  = value.slice(0, at);
  const domain = value.slice(at + 1);

  /* ---- local part ---- */
  if (local.length > 64) return false;
  if (!/^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+$/.test(local)) return false;
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;

  /* ---- domain ---- */
  if (domain.length > 253) return false;
  const labels = domain.split(".");
  if (labels.length < 2) return false;
  if (!labels.every((l) => /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(l))) return false;
  if (!/^[A-Za-z]{2,}$/.test(labels[labels.length - 1])) return false;

  return true;
}

const V = (() => {

  /* ---------- Individual checks (return true when valid) ---------- */
  const required = (v) => v.trim().length > 0;
  const email    = (v) => isValidEmail(v);
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

  return { required, email, isValidEmail, phone, minLen, number, positive,
           cardNumber, cvv, upiId, expiry,
           validate, liveClear, setError, clearError };
})();
