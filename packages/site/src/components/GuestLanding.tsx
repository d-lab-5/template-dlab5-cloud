import * as React from "react";
import { ThemeSegments } from "./ThemeSegments";

/**
 * What a visitor sees before signing in.
 *
 * ADR-0002 settled that there is no anonymous access and no self-service
 * sign-up. Nothing here is fetched, no tenant or space is named, and the only
 * control that does anything is the sign-in form passed in as `children`. A
 * page that showed counts, names or a "recent activity" strip would be leaking
 * to someone who has not signed in.
 *
 * What it is NOT is a bare password box on an empty background. A visitor
 * should arrive at something that says what this is.
 */
export function GuestLanding({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell app-shell--railed app-shell--guest">
      <nav className="app-rail" aria-label="Sign in">
        <span className="app-rail__brand">
          <Mark />
          <span>
            template<span className="app-rail__brandaccent">.dlab5</span>
          </span>
        </span>

        <div className="app-rail__section">
          <h2 className="app-rail__sectionlabel">Access</h2>
          {children}
        </div>

        {/* Appearance before sign-in, not after. Someone arriving at night
            should be able to turn the lights down without authenticating
            first, and this is the screen they are looking at. */}
        <div className="app-rail__section">
          <h2 className="app-rail__sectionlabel">Appearance</h2>
          <ThemeSegments />
        </div>

        <div className="app-rail__section">
          <h2 className="app-rail__sectionlabel">Accounts</h2>
          <p className="app-rail__note">
            There is no sign-up. Accounts are created by an administrator, who
            also grants access to a tenant's spaces. If you were invited, use the
            temporary password from your invitation email — you will be asked
            to choose a new one.
          </p>
        </div>
      </nav>

      <div className="app-shell__body">
        {/* Order is the argument this page makes: what the repository IS,
            then whose it is, then what it is for. The mark sits between the
            claim and the product line rather than on top of them, so the
            heading is what a reader lands on first. */}
        <main className="app-shell__main app-guest">
          <p className="app-hero__eyebrow">D-LAB-5</p>

          <h1 className="app-hero__title">
            A starting point,{" "}
            <span className="app-hero__titleaccent">not a product</span>
          </h1>

          <Logo />

          {/* A paragraph, not a second heading. The page already has its one
              subject above; making this an h2 would give it two. */}
          <p className="app-guest__tagline">
            The Digital Twin Platform and Product Engineers
          </p>

          <p className="app-hero__lede">
            Gatsby 5 and React 18 in front, an AWS Amplify Gen 2 backend
            behind, and one Cognito gate over the whole thing. Fork it, run{" "}
            <code>npm run rename</code>, and start on the part that is actually
            yours.
          </p>

          {/* An outbound link, so it carries noreferrer noopener — the tab it
              opens must not get a handle on this one. */}
          <a
            className="app-coffee"
            href="https://buymeacoffee.com/dlab5"
            target="_blank"
            rel="noreferrer noopener"
          >
            <CoffeeIcon />
            Buy me a coffee
          </a>
        </main>
      </div>
    </div>
  );
}

/**
 * The mark, in whichever theme is showing.
 *
 * Both files are rendered and CSS hides one, rather than swapping `src` from
 * the theme hook. The hook starts at "dark" on the first client render to
 * match what the server emitted, so a src swap would paint the dark logo and
 * then replace it — a visible flicker for every light-theme visitor, on the
 * first screen they ever see. CSS keyed on the same `data-app-theme` attribute
 * the pre-paint script already set has no such gap.
 *
 * The cost is that both files are fetched. They are ~100 KB each, and this is
 * the only page that shows them.
 *
 * Served from `static/`, so the paths are literal and stable rather than
 * content-hashed imports. That is the trade `static/` makes: a replaced logo
 * keeps its URL, so a cache can hand back the old one. If that ever bites,
 * the fix is a query string on these two src values, not a new directory.
 */
function Logo() {
  return (
    <div className="app-guest__logo">
      <img
        className="app-guest__logoimg app-guest__logoimg--dark"
        src="/logo-dark.png"
        alt="D-LAB-5 — Twin. Experiment. Automate."
        width={480}
        height={480}
      />
      <img
        className="app-guest__logoimg app-guest__logoimg--light"
        src="/logo-light.png"
        alt="D-LAB-5 — Twin. Experiment. Automate."
        width={480}
        height={480}
      />
    </div>
  );
}

function CoffeeIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 8h12v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8Z" />
      <path d="M16 9h1.5a2.5 2.5 0 0 1 0 5H16" />
      <path d="M7 2v2.5M10.5 2v2.5M14 2v2.5" />
      <path d="M3 21h14" />
    </svg>
  );
}

function Mark() {
  return (
    <span className="app-mark" aria-hidden="true">
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        strokeWidth="2"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="3" width="18" height="18" rx="4" />
        <path d="M8 8h8M8 12h5M8 16h3" />
      </svg>
    </span>
  );
}
