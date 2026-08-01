export const AUTOFILL_COMPATIBILITY_CORPUS_VERSION = 1 as const;

export type PasswordPurpose = "current" | "new";

export interface AutofillCompatibilityCase {
  readonly expectedPasswordPurposes: readonly PasswordPurpose[];
  readonly html: string;
  readonly id: string;
  readonly pathname: string;
}

/**
 * A deliberately framework-free compatibility corpus. Every real-world regression should be
 * reduced to one bounded fixture here before its detector is changed. The corpus contains no live
 * credentials or third-party scripts and is safe to run in JSDOM and browser smoke tests.
 */
export const AUTOFILL_COMPATIBILITY_CORPUS: readonly AutofillCompatibilityCase[] = [
  {
    expectedPasswordPurposes: ["current"],
    html: `<form><input autocomplete="username"><input type="password" autocomplete="current-password"><button>Sign in</button></form>`,
    id: "standard-login",
    pathname: "/login",
  },
  {
    expectedPasswordPurposes: ["current"],
    html: `<form id="login"><input name="user"><input name="password" type="password" autocomplete="new-password"><button>Login</button></form>`,
    id: "mislabelled-new-password-login",
    pathname: "/login",
  },
  {
    expectedPasswordPurposes: ["current"],
    html: `<form action="/session"><input type="email" name="email"><input type="password" name="password"><button>Continue</button></form>`,
    id: "continue-login",
    pathname: "/session",
  },
  {
    expectedPasswordPurposes: ["new", "new"],
    html: `<form action="/register"><input type="email"><input type="password" autocomplete="new-password"><input type="password" aria-label="Confirm password"><button>Create account</button></form>`,
    id: "standard-registration",
    pathname: "/register",
  },
  {
    expectedPasswordPurposes: ["new"],
    html: `<form aria-label="Sign up"><input type="password" name="password"><button>Join</button></form>`,
    id: "signup-without-autocomplete",
    pathname: "/join",
  },
  {
    expectedPasswordPurposes: ["current", "new", "new"],
    html: `<form aria-label="Change password"><input type="password" autocomplete="current-password" aria-label="Current password"><input type="password" autocomplete="new-password" aria-label="Create password"><input type="password" autocomplete="new-password" aria-label="Confirm password"><button>Save password</button></form>`,
    id: "change-password",
    pathname: "/change-password",
  },
  {
    expectedPasswordPurposes: ["new", "new"],
    html: `<form><h1>Reset password</h1><input type="password" aria-label="New password"><input type="password" aria-label="Confirm new password"><button>Reset password</button></form>`,
    id: "reset-password",
    pathname: "/reset",
  },
  {
    expectedPasswordPurposes: ["new", "new"],
    html: `<form><h1>Change password</h1><input type="password" aria-label="Create password"><input type="password" aria-label="Confirm password"><button>Save password</button></form>`,
    id: "google-style-speedbump-change",
    pathname: "/v3/signin/speedbump/changepassword",
  },
  {
    expectedPasswordPurposes: ["current"],
    html: `<form><input autocomplete="username"><input type="password"><button aria-label="Next">Next</button></form>`,
    id: "next-step-login",
    pathname: "/challenge/password",
  },
  {
    expectedPasswordPurposes: ["new"],
    html: `<form name="registration"><input name="fullName"><input name="password" type="password"><button>Register</button></form>`,
    id: "registration-name-not-username",
    pathname: "/account/register",
  },
  {
    expectedPasswordPurposes: ["current"],
    html: `<form class="auth"><h2>Welcome back</h2><input type="email"><input type="password"><button>Sign in</button></form>`,
    id: "welcome-back-login",
    pathname: "/auth",
  },
  {
    expectedPasswordPurposes: ["new"],
    html: `<form><input type="password" autocomplete="new-password" passwordrules="minlength: 15; required: upper; required: digit;"><button>Create account</button></form>`,
    id: "password-rules-registration",
    pathname: "/signup",
  },
] as const;
