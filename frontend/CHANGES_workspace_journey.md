# Workspace journey merge (front end only)
- Renamed "CAD Studio" to "Workspace" in 16 front-end files (nav, buttons, titles, SEO tags, gate, FAQ). File names (studio.html) unchanged so no links break.
- index.html: hero idea box ("What are we building today?" + project-type chips) hands off to the Workspace via the existing `nito_prefill` sessionStorage key. New "Inside the Workspace" interactive example (requirements with 5 states, checks, revision compare, activity, history). Five requirement states under the requirements table. Six-step journey replaces the 3-step "Set it. Prove it. Take it." (all its content kept). Status tags on the six disciplines. New "A design is more than a 3D file" record section. Sections renumbered.
- studio.html: sign-in gate copy aligned with the journey.
- New files: journey.css, journey.js. No back-end changes.

## Fixes: overlap, send button, ask before building
- studio.css: the size label (X ... x Y ...) no longer sits under the Z up and Axes buttons. It moved below them.
- studio.html / studio.js: the send button was disabled on arrival from the home page because the prefill event fired before the input listener existed. It is now only disabled while a message is being worked on (`syncSend()`), and an empty click focuses the box.
- studio.js: a vague first message ("I want to build a car", "Tesla", "a bridge") gets a questions card for its field instead of a build. The request is kept and sent with the answers. Specific requests (two or more sizes) go straight through.
- studio.js: attaching a file or picture now adds a reply saying what it is, the sizes found (or a request for them), and asks what to do. Nothing is built.
- BACKEND_INTAKE.md: the matching rule for the server (back end was not in the zip).
