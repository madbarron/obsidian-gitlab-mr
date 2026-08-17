# GitLab MR — Obsidian plugin

Renders GitLab merge request links in your notes as compact inline status chips, the way
the Jira Issue plugin does for Jira issues.

```
Open  GT  monkey-island/231  Find Big Whoop  (2)  ●  ❌LC 💬EM
Open      monkey-island/88   Defeat the Sword Master  ●  ✅SM       [Merge]
```

state · author (only when it isn't you) · project/iid · title · unresolved threads ·
pipeline · per-reviewer approval · merge button (only on your own ready MRs)

Colors are GitLab's own Pajamas palette, using the `-500` shades in light mode and the
`-400` shades in dark, so a chip reads like the badge on the MR page.

## Install

Use [BRAT](https://github.com/TfTHacker/obsidian42-brat). It installs a plugin straight
from a GitHub release and re-checks for a newer one every time Obsidian starts.

1. **Settings → Community plugins** — turn Restricted mode off if it is on, then **Browse**,
   search for **BRAT**, and install and enable it.
2. Open the command palette and run **BRAT: Add a beta plugin for testing**.
3. Paste `madbarron/obsidian-gitlab-mr` and confirm.
4. Back under **Community plugins**, enable **GitLab MR**.
5. Open its settings, set **Base URL** to your GitLab instance (it defaults to
   `https://gitlab.com`), paste a token — see [Creating the token](#creating-the-token) — and
   press **Test connection**.

<details>
<summary>Manual install, without BRAT</summary>

Download `main.js`, `manifest.json` and `styles.css` from the
[latest release](https://github.com/madbarron/obsidian-gitlab-mr/releases/latest) into
`<vault>/.obsidian/plugins/obsidian-gitlab-mr/`, then reload Obsidian and enable the plugin
under Community plugins. You have to repeat this by hand for every update, which is the
reason BRAT is worth the one-time install.

</details>

## Link syntaxes

| You write                                                   | Resolves to                                                             |
| ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| `https://gitlab.com/org/group/project/-/merge_requests/231` | that merge request (trailing `/diffs`, `?query` and `#note_1` are fine) |
| `!project/231`                                              | `<group base>/project!231`                                              |
| `!other-team/proj/12`                                       | `<group base>/other-team/proj!12`                                       |
| `!/gitlab-org/gitlab/45`                                    | `gitlab-org/gitlab!45` — a leading slash ignores the group base         |

Anything inside backticks or a fenced code block is left alone, which is how you write a
literal reference. Labeled markdown links (`[the MR](https://…)`) keep their label.

## Indicators

**Status** — `Open` (green), `Draft` (grey), `Merged` (blue), `Closed` (red), `Locked`.
Draft wins over open.

**Author** — initials in a grey pill, shown only when the author is not you, with the full
name on hover. Turn it off with _Show author initials_.

**Threads** — `(n)` unresolved threads in orange, hidden when there are none.

**Pipeline** — a colored dot: green passed · red failed · blue pulsing running · orange
waiting · hollow grey paused (a manual job) · grey canceled · dashed grey skipped. Nothing is
shown when the merge request has no pipeline. Clicking the dot opens the pipeline; hovering
shows GitLab's own status wording and the failure reason. Running pipelines refresh every 30
seconds regardless of the cache setting.

**Reviewers** — a glyph plus initials per reviewer: ✅ approved · ❗ requested changes ·
💬 reviewed · 👀 review started · ⚪ not reviewed yet. Anyone who approved without being a
requested reviewer is appended. Hover for the full name and state.

**Merge button** — appears only when _all_ of these hold: the MR is yours, it is open and not
a draft, GitLab itself reports `detailedMergeStatus: MERGEABLE` (which already accounts for
approvals, unresolved threads, conflicts and required CI per the project's settings), you have
permission to merge it, and your token has the `api` scope. Clicking opens a confirmation
modal — nothing is ever merged on a single click:

- shows the branches (`feature/x → main`) and the MR title
- _Squash commits_ and _Delete source branch_, pre-filled from the project's own defaults and
  locked when the project forces them
- the merge sends GitLab the head commit SHA, so if anyone pushed since the chip was rendered
  GitLab refuses the merge and the modal tells you to look at what changed

A read-only (`read_api`) token means the button does not exist at all. _Show merge button_ in
settings switches it off regardless.

Click a chip to open the merge request. **Shift+click** forces a refresh. There is also a
`GitLab MR: Refresh all merge requests` command.

## Settings

| Setting                            | Default              | Notes                                                         |
| ---------------------------------- | -------------------- | ------------------------------------------------------------- |
| Base URL                           | `https://gitlab.com` | Only merge requests on this host are rendered                 |
| Group base                         | _(empty)_            | Prefix for shorthand, e.g. `org/group`                        |
| Personal access token              | —                    | `read_api`, or `api` if you want the merge button — see below |
| Render while editing               | on                   | Live Preview chips                                            |
| Show title / max length            | on / 60              | Titles truncate with an ellipsis                              |
| Show full project path             | off                  | `project/231` vs `org/group/project/231`                      |
| Show pipeline / reviewers / author | on                   |                                                               |
| Show merge button                  | on                   | Ignored when the token cannot write                           |
| Cache duration                     | 5 min                | Active pipelines always use 30s                               |

### Creating the token

1. Open `<base URL>/-/user_settings/personal_access_tokens?name=Obsidian+GitLab+MR&scopes=read_api`
   (older self-hosted instances use `/-/profile/personal_access_tokens`).
2. Name it, set an expiry (gitlab.com allows up to 365 days).
3. Scope: **`read_api`** renders every chip. Choose **`api`** instead only if you want the
   merge button — merging is a write action and `read_api` cannot do it. Nothing broader than
   `api` is ever needed.
4. Paste it into the plugin settings and press **Test connection**. It reports the username and
   the token's scopes, e.g. `✓ connected as guybrush — token scope: read_api (merge button
hidden — needs the api scope)`.

The plugin checks its own token's scopes via `GET /api/v4/personal_access_tokens/self` — the
only REST call it makes — and treats anything it cannot confirm as read-only.

The token is stored in plain text in `.obsidian/plugins/obsidian-gitlab-mr/data.json`.
Exclude that file from any sync you do not trust, and revoke the token from the same GitLab
page if it leaks.

## Development

```bash
npm install
npm run dev
```

`dev` watches and writes `main.js`, `manifest.json` and `styles.css` into `./dist`. To build
straight into a vault instead, copy `.env.example` to `.env` (git-ignored) and name your
vault — relative paths resolve from your home directory, and `.obsidian/plugins/<plugin-id>`
is appended for you:

```
OBSIDIAN_VAULT=Obsidian/MyVault
```

Set `OBSIDIAN_PLUGIN_DIR` instead to name the plugin folder outright; it takes precedence, and
both accept `~`.

### Dependency notes

`@codemirror/state` and `@codemirror/view` are pinned to exact versions on purpose, and
`npm outdated` will always report them as behind. `obsidian` peer-depends on those exact
versions, and Obsidian ships its own CodeMirror at runtime — the build marks them `external`,
so nothing from `node_modules` is bundled. They exist here only to type-check against the
same CodeMirror the host actually provides. Bumping them past the peer range breaks
`npm install` and lets code compile against APIs your Obsidian does not have; the way to move
them is to upgrade `obsidian` and follow its peers.

`@types/node` tracks the Node major you run (24), not the newest published types, so the build
scripts cannot compile against APIs that are missing at runtime.

Other scripts:

- `npm run build` — typecheck, then a minified build into the same folder
- `npm test` — unit tests for the parser, the formatters and the chip DOM
- `npm run probe -- my-project 231` — hit the real API outside Obsidian to validate a
  token or a path (reads `GITLAB_TOKEN`, `GITLAB_BASE_URL`, `GITLAB_GROUP_BASE` from `.env`)

### Releasing

```bash
npm version patch && git push --follow-tags
```

`npm version` runs `version-bump.mjs`, which copies the new version into `manifest.json` and
records `version -> minAppVersion` in `versions.json`, so the tag and the manifest cannot
drift. `.npmrc` drops npm's `v` prefix because Obsidian resolves versions by bare tag name.

The rest is [`.github/workflows/release.yml`](.github/workflows/release.yml): it tests, builds,
and creates a release carrying `main.js`, `manifest.json` and `styles.css` as three separate
assets — the layout BRAT downloads by name. It refuses to publish when `manifest.json`
disagrees with the tag. There are no secrets to configure; the workflow's automatic
`GITHUB_TOKEN` plus `permissions: contents: write` is all it needs.

### How it works

`src/parser.ts` finds references in text (pure, unit-tested). `src/cache.ts` coalesces every
reference on screen into one batched GraphQL request via `src/gitlab/client.ts`
(`requestUrl`, so no CORS problems), caches with stale-while-revalidate, and notifies
subscribers. `src/render/chip.ts` is the only place that builds DOM; `render/reading.ts` and
`render/livePreview.ts` are thin surfaces over it. `src/gitlab/identityProbe.ts` resolves who
the token belongs to and whether it can write, persisting the answer so chips render correctly
while offline.

Modules that hold logic worth testing avoid importing `obsidian` (which ships types only, with
no runtime entry): `parser.ts`, `format.ts` — including `canOfferMerge` and `shouldShowAuthor` —
`identity.ts` and `gitlab/query.ts`'s `buildMergeInput` are all plain functions under test.
`render/chip.ts` only needs Obsidian's DOM helpers, which `tests/obsidianDom.ts` stands in for,
so the chip is asserted as real DOM in jsdom.
