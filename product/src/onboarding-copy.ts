// Conversational onboarding copy lives here, not in the Worker entry module:
// workerd treats every export of src/index.ts as an entrypoint and refuses to
// boot when a non-handler (a string) is exported there (found 2026-11-04:
// `wrangler dev` failed with "Incorrect type for map entry 'LOCATION_ASK_PROMPT'").
export const LOCATION_ASK_PROMPT =
  "Where are you based, and how far do you serve? For example: 'Ikeja, Lagos, Nigeria', 'Lagos, Nigeria - nationwide', or 'Online / Worldwide' if there is no fixed base.";
