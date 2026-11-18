# Workspace journey merge (front end only)
- Renamed "CAD Studio" to "Workspace" in 16 front-end files (nav, buttons, titles, SEO tags, gate, FAQ). File names (studio.html) unchanged so no links break.
- index.html: hero idea box ("What are we building today?" + project-type chips) hands off to the Workspace via the existing `nito_prefill` sessionStorage key. New "Inside the Workspace" interactive example (requirements with 5 states, checks, revision compare, activity, history). Five requirement states under the requirements table. Six-step journey replaces the 3-step "Set it. Prove it. Take it." (all its content kept). Status tags on the six disciplines. New "A design is more than a 3D file" record section. Sections renumbered.
- studio.html: sign-in gate copy aligned with the journey.
- New files: journey.css, journey.js. No back-end changes.
