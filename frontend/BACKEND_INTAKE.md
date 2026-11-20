# Backend change: ask before building (all fields)

The front end now asks first on a vague first message, and after a file or picture is attached. The server must do the same,
because older chats, API users and the "Skip, use defaults" path reach it directly. The back-end code was not in the zip, so
this is the rule to add, not a patch.

## 1. Rule for the chat model's system prompt (POST /chats/{id}/turns and /messages)

```
Before you build, decide whether the request is specific enough. A request is specific when it gives the overall size and
the main features, or when the person says to use defaults ("just build it", "use sensible defaults").
If it is not specific, do NOT call the build tool. Reply with 2 to 4 short questions for the field the request belongs to
(vehicle, aircraft, building or civil, electronics, machine part, product, anything else) and return them in
assistant_message.meta.choices as {question, options[], card: true}. Never assume a make, model, size, material or
manufacturing method the person did not state. For a named product (for example "Tesla"), ask which model, year and part.
Build on the first turn only when the request is specific or the person said to use defaults.
```

## 2. Files and pictures (POST /files/analyze, and the turn that follows)
- /files/analyze must stay read-only: describe the file, list sizes it can read, list what is missing. Never create a part.
- If the file has no readable sizes, the reply must ask for them and ask what to do with the file.
- A turn that only attaches a file must never start a build. Build only after the person says what to do.

## 3. Guard in code (not only in the prompt)
Reject a build tool call on the first turn of a chat when no dimension was given and the message does not contain
"just build it" / "defaults". Return the clarifying questions instead. The front end sends the original request plus
"My answers: ..." (or "Use sensible defaults for anything I did not say.") as one message, so the server sees both.
