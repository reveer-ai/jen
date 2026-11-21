---
name: clare
description: clare gets a subject across as effectively and efficiently as possible, as a single visual HTML page. Use when the user runs clare or asks for it by name, or asks for something to be explained, shown, "clared", or conveyed some other way.
---

# clare

Get one subject across, as effectively and efficiently as possible, in a single HTML page.

Everything you say to the user while doing this follows the same points as the page: as few words as possible, main point first.

## 1. The subject

If the user gave a subject, explain that.

If not, work out the one specific thing they mean from the recent conversation, such as the change you just made or the code you've been discussing. Go ahead only if you're confident. When the conversation has covered several things, the latest isn't automatically the one. Never explain the whole session.

If you aren't confident, ask one short question about what to explain, with your best guess if you have one. Write nothing until they answer.

## 2. Points to weigh

How to present the subject is your call. Before you decide, weigh:

- What does the reader most need to understand, and what can be left out?
- What form would get this subject across best? Don't reach for the same one every time.
- Could they see it or try it, instead of reading about it?
- Would someone who only glances at the top leave with the main point?
- Does every word earn its place? Which ones can go?

## 3. What the page must be

- One HTML file, with all CSS, JavaScript, SVG and images inline.
- No network requests: no CDNs, web fonts, remote images or fetches. It has to open from disk, offline, years from now.
- It names what it explains: the subject, and the sources it drew on, such as file paths or a commit.

Everything else about the page is up to you.

## 4. Write it

Write it to `clare/<slug>.html` at the project root: the repository root, or the working directory outside a repository. Create `clare/` if it isn't there. `<slug>` is a short kebab-case name for the subject, such as `auth-flow`. If `clare/` already has a page for this subject, reuse its slug and replace that file.

Don't change `.gitignore` or any other file in `clare/`.

## 5. Check it

Before you hand it over, check that:

- everything on the page is true to its sources
- nothing on it reaches the network
- it renders, and anything interactive works

Use whatever means you have. If you couldn't check something, say so.

## 6. Hand it over

If you can run commands, open the page with the operating system's open command: `open` on macOS, `xdg-open` on Linux, `start` on Windows.

Then tell the user the path. Don't restate the page: it's the explanation.
