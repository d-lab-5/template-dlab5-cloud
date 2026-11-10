import * as React from "react";
import type { WrapPageElementBrowserArgs } from "gatsby";
import { AuthGate } from "./components/AuthGate";
import { BusyCard, HelpLayer } from "./components/Feedback";
import { I18nProvider } from "./lib/i18n";

/**
 * Shared by gatsby-browser and gatsby-ssr so the element tree is identical on
 * both sides. If only the browser wrapped pages, server rendering would call
 * page components directly and `useSession()` would throw — and the markup the
 * client hydrates would not match what the server produced.
 */
export const wrapPageElement = ({
  element,
}: Pick<WrapPageElementBrowserArgs, "element">) => (
  // the loading card and button help, outside the gate so the sign-in page
  // has them too (components/Feedback.tsx)
  <I18nProvider><AuthGate>{element}</AuthGate><BusyCard /><HelpLayer /></I18nProvider>
);
