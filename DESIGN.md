---
version: alpha
name: Gongchengbao-Miniapp-design
description: "A bright, data-dense WeChat mini-program for interior-renovation project management. Built on a near-white blue-washed canvas (#F5F7FA) with white 12px cards, a single confident brand blue (#165DFF) reserved for primary actions, active tabs, progress fills and the numbers people came to read, and a restrained semantic set whose text tones are darkened for legibility (success #087A1E, warning #A85400, danger #B22A26). Identity is carried by role color — foreman green, supervisor blue, owner amber — repeated on avatar badges, role chips and the four-tab bar. Type is PingFang SC at 700 for numbers and 600 for headings, with body at 400; nothing is smaller than 11px, and every text colour is WCAG AA verified against the surface it sits on. The layout is a vertical card stack with 16px gutters, hairline dividers instead of heavy shadows, and large tappable rows (≥44px). The mood is 'written on site, read on the way home': clear, calm, and legible at arm's length in daylight."

colors:
  primary: "#165DFF"
  primary-pressed: "#0E42D2"
  primary-soft: "#E8F0FF"
  primary-wash: "#F2F7FF"
  on-primary: "#FFFFFF"
  canvas: "#F5F7FA"
  surface: "#FFFFFF"
  surface-sunken: "#F7F8FA"
  surface-overlay: "#FFFFFF"
  ink: "#1D2129"
  ink-secondary: "#4E5969"
  ink-tertiary: "#626B79"
  hairline: "#E5E6EB"
  hairline-strong: "#C9CDD4"
  scrim: "rgba(29, 33, 41, 0.45)"
  chart-track: "#F2F3F5"
  semantic-success: "#00B42A"
  semantic-success-soft: "#E8FFEA"
  semantic-success-ink: "#087A1E"
  semantic-warning: "#FF7D00"
  semantic-warning-soft: "#FFF7E8"
  semantic-warning-ink: "#A85400"
  semantic-danger: "#F53F3F"
  semantic-danger-solid: "#C62828"
  semantic-danger-soft: "#FFECE8"
  semantic-danger-ink: "#B22A26"
  semantic-neutral: "#86909C"
  semantic-neutral-soft: "#F2F3F5"
  semantic-neutral-ink: "#5E6673"
  role-foreman-soft: "#E8FFEA"
  role-foreman-ink: "#087A1E"
  role-supervisor-soft: "#E8F0FF"
  role-supervisor-ink: "#0E42D2"
  role-owner-soft: "#FFF7E8"
  role-owner-ink: "#A85400"

typography:
  display-xl:
    fontFamily: PingFang SC
    fontSize: 34px
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: -0.6px
  display-lg:
    fontFamily: PingFang SC
    fontSize: 28px
    fontWeight: 700
    lineHeight: 1.20
    letterSpacing: -0.4px
  display-number:
    fontFamily: PingFang SC
    fontSize: 40px
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: -1.0px
  title-lg:
    fontFamily: PingFang SC
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1.30
    letterSpacing: -0.2px
  title:
    fontFamily: PingFang SC
    fontSize: 17px
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: 0
  title-sm:
    fontFamily: PingFang SC
    fontSize: 15px
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: 0
  body:
    fontFamily: PingFang SC
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.60
    letterSpacing: 0
  body-sm:
    fontFamily: PingFang SC
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.50
    letterSpacing: 0
  caption:
    fontFamily: PingFang SC
    fontSize: 11px
    fontWeight: 400
    lineHeight: 1.40
    letterSpacing: 0
  button:
    fontFamily: PingFang SC
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.20
    letterSpacing: 0
  button-sm:
    fontFamily: PingFang SC
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1.20
    letterSpacing: 0
  chip:
    fontFamily: PingFang SC
    fontSize: 11px
    fontWeight: 500
    lineHeight: 1.30
    letterSpacing: 0
  eyebrow:
    fontFamily: PingFang SC
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.30
    letterSpacing: 0.5px
  amount:
    fontFamily: PingFang SC
    fontSize: 17px
    fontWeight: 600
    lineHeight: 1.30
    letterSpacing: 0

rounded:
  xs: 4px
  sm: 6px
  md: 8px
  lg: 12px
  xl: 16px
  xxl: 20px
  pill: 999px
  full: 999px

spacing:
  xxs: 2px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 20px
  xxl: 24px
  section: 32px
  gutter: 16px

components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: 12px 20px
    height: 48px
  button-primary-pressed:
    backgroundColor: "{colors.primary-pressed}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    height: 48px
  button-primary-disabled:
    backgroundColor: "{colors.primary-soft}"
    textColor: "{colors.ink-tertiary}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    height: 48px
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: 11px 20px
    height: 48px
  button-ghost:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-secondary}"
    typography: "{typography.button-sm}"
    rounded: "{rounded.sm}"
    padding: 8px 12px
  button-danger:
    backgroundColor: "{colors.semantic-danger-solid}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    height: 48px
  button-text-link:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.xs}"
    padding: 4px 0
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: 16px
  card-hero:
    backgroundColor: "{colors.primary-soft}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.xl}"
    padding: 20px
  card-sunken:
    backgroundColor: "{colors.surface-sunken}"
    textColor: "{colors.ink-secondary}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: 12px
  card-divider:
    backgroundColor: "{colors.hairline}"
    rounded: "{rounded.xs}"
    height: 1px
  project-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: 16px
  stage-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.title-sm}"
    rounded: "{rounded.md}"
    padding: 14px 16px
  list-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.xs}"
    padding: 14px 16px
  list-row-pressed:
    backgroundColor: "{colors.surface-sunken}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.xs}"
    padding: 14px 16px
  chevron:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-tertiary}"
    typography: "{typography.caption}"
    width: 16px
    height: 16px
  progress-track:
    backgroundColor: "{colors.chart-track}"
    rounded: "{rounded.pill}"
    height: 6px
  progress-fill:
    backgroundColor: "{colors.primary}"
    rounded: "{rounded.pill}"
    height: 6px
  progress-fill-done:
    backgroundColor: "{colors.semantic-success}"
    rounded: "{rounded.pill}"
    height: 6px
  chip-active:
    backgroundColor: "{colors.primary-soft}"
    textColor: "{colors.primary-pressed}"
    typography: "{typography.chip}"
    rounded: "{rounded.xs}"
    padding: 2px 6px
  chip-pending:
    backgroundColor: "{colors.semantic-warning-soft}"
    textColor: "{colors.semantic-warning-ink}"
    typography: "{typography.chip}"
    rounded: "{rounded.xs}"
    padding: 2px 6px
  chip-passed:
    backgroundColor: "{colors.semantic-success-soft}"
    textColor: "{colors.semantic-success-ink}"
    typography: "{typography.chip}"
    rounded: "{rounded.xs}"
    padding: 2px 6px
  chip-danger:
    backgroundColor: "{colors.semantic-danger-soft}"
    textColor: "{colors.semantic-danger-ink}"
    typography: "{typography.chip}"
    rounded: "{rounded.xs}"
    padding: 2px 6px
  chip-neutral:
    backgroundColor: "{colors.semantic-neutral-soft}"
    textColor: "{colors.semantic-neutral-ink}"
    typography: "{typography.chip}"
    rounded: "{rounded.xs}"
    padding: 2px 6px
  role-chip-foreman:
    backgroundColor: "{colors.role-foreman-soft}"
    textColor: "{colors.role-foreman-ink}"
    typography: "{typography.chip}"
    rounded: "{rounded.xs}"
    padding: 2px 6px
  role-chip-supervisor:
    backgroundColor: "{colors.role-supervisor-soft}"
    textColor: "{colors.role-supervisor-ink}"
    typography: "{typography.chip}"
    rounded: "{rounded.xs}"
    padding: 2px 6px
  role-chip-owner:
    backgroundColor: "{colors.role-owner-soft}"
    textColor: "{colors.role-owner-ink}"
    typography: "{typography.chip}"
    rounded: "{rounded.xs}"
    padding: 2px 6px
  icon-tile:
    backgroundColor: "{colors.primary-soft}"
    textColor: "{colors.primary}"
    rounded: "{rounded.full}"
    width: 44px
    height: 44px
  avatar-foreman:
    backgroundColor: "{colors.role-foreman-soft}"
    textColor: "{colors.role-foreman-ink}"
    typography: "{typography.chip}"
    rounded: "{rounded.full}"
    width: 40px
    height: 40px
  avatar-supervisor:
    backgroundColor: "{colors.role-supervisor-soft}"
    textColor: "{colors.role-supervisor-ink}"
    typography: "{typography.chip}"
    rounded: "{rounded.full}"
    width: 40px
    height: 40px
  avatar-owner:
    backgroundColor: "{colors.role-owner-soft}"
    textColor: "{colors.role-owner-ink}"
    typography: "{typography.chip}"
    rounded: "{rounded.full}"
    width: 40px
    height: 40px
  status-dot-active:
    backgroundColor: "{colors.primary}"
    rounded: "{rounded.full}"
    width: 10px
    height: 10px
  status-dot-passed:
    backgroundColor: "{colors.semantic-success}"
    rounded: "{rounded.full}"
    width: 10px
    height: 10px
  status-dot-pending:
    backgroundColor: "{colors.semantic-warning}"
    rounded: "{rounded.full}"
    width: 10px
    height: 10px
  status-dot-danger:
    backgroundColor: "{colors.semantic-danger}"
    rounded: "{rounded.full}"
    width: 10px
    height: 10px
  status-dot-locked:
    backgroundColor: "{colors.semantic-neutral}"
    rounded: "{rounded.full}"
    width: 10px
    height: 10px
  stat-tile:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.display-number}"
    rounded: "{rounded.lg}"
    padding: 16px 12px
  tab-bar:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-tertiary}"
    typography: "{typography.caption}"
    height: 56px
  tab-item-active:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    typography: "{typography.caption}"
  tab-item-inactive:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-tertiary}"
    typography: "{typography.caption}"
  text-input:
    backgroundColor: "{colors.surface-sunken}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 12px 14px
    height: 48px
  text-input-focused:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 11px 13px
    height: 48px
  upload-tile:
    backgroundColor: "{colors.surface-sunken}"
    textColor: "{colors.ink-tertiary}"
    typography: "{typography.caption}"
    rounded: "{rounded.md}"
    width: 88px
    height: 88px
  sheet-handle:
    backgroundColor: "{colors.hairline-strong}"
    rounded: "{rounded.pill}"
    width: 36px
    height: 4px
  bottom-sheet:
    backgroundColor: "{colors.surface-overlay}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.xl}"
    padding: 20px 16px
  modal-backdrop:
    backgroundColor: "{colors.scrim}"
  notice-banner:
    backgroundColor: "{colors.primary-wash}"
    textColor: "{colors.ink-secondary}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: 12px 14px
  warning-banner:
    backgroundColor: "{colors.semantic-warning-soft}"
    textColor: "{colors.semantic-warning-ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: 12px 14px
  ledger-row-expense:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.xs}"
    padding: 14px 16px
  ledger-amount-expense:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.semantic-danger-ink}"
    typography: "{typography.amount}"
  ledger-amount-income:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.semantic-success-ink}"
    typography: "{typography.amount}"
  signature-pad:
    backgroundColor: "{colors.surface-sunken}"
    textColor: "{colors.ink-tertiary}"
    typography: "{typography.caption}"
    rounded: "{rounded.md}"
    height: 200px
  empty-state:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink-tertiary}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: 48px 24px
---

## Overview

工程宝 is a **WeChat mini-program for interior renovation projects**. It is used standing up, in a dusty flat, with one hand, often on site and sometimes in bright daylight. That single sentence drives every decision below: large tap targets, high-contrast text, numbers that read at arm's length, and never more than one thing to do on a screen.

The canvas is `{colors.canvas}` (#F5F7FA) — a cool near-white with a faint blue cast, not pure gray. Cards are pure white `{colors.surface}` with `{rounded.lg}` 12px corners, 16px padding, and **hairline borders** (`{colors.hairline}`) rather than drop shadows. Shadows exist but are almost invisible; elevation is communicated by the border and by the surface step, not by blur.

The single chromatic accent is **工程宝蓝** `{colors.primary}` (#165DFF). It appears on: the brand mark, the one primary CTA per screen, the active tab, progress-bar fills, active filter chips, and the big numbers (60% progress, ¥30,000) that are the reason the user opened the page. It is never used as a card fill or a section background.

**Identity is carried by role color**, not by layout: 工长 green, 监理 blue, 业主 amber. The same three hues repeat on the avatar badge, the role chip, and the role card on the onboarding screen, so a user can tell at a glance which hat they are wearing. The layout itself stays identical across roles — only the available tabs and the numbers change.

Semantics are strictly reserved: green = passed/settled, amber = pending/awaiting, red = rejected/overdue/destructive, gray = not started/archived. **Amber and red never appear decoratively**, and a status is never conveyed by color alone — every chip carries a two-to-four-character label.

**Key Characteristics:**

- **Light, not dark.** Mini-programs are opened in daylight; the whole system is light-surface. No dark mode is designed (see Known Gaps).
- **One primary CTA per screen.** Bottom-pinned, 48px tall, full-width-minus-gutters.
- **Card stack, not dashboard.** Vertical rhythm of 12px gaps between cards, 16px page gutters. No masonry, no carousels, no dense tables.
- **Numbers are the heroes.** Project progress, stage progress, amounts — set at `{typography.display-number}` / `{typography.amount}` with tabular figures so totals don't jitter while scrolling.
- **Never more than two levels of nesting.** Card → row. A card inside a card only happens for the stage timeline, and there the inner element is a hairline-separated row, not another card.
- **Every blocked state explains itself.** A locked stage, a disabled button, an empty list — each says *why* in `{colors.ink-tertiary}` body-sm, in one sentence.
- **Chinese-first, no icon-only actions.** Labels are set in PingFang SC; icons always pair with text.
- **Contrast is verified, not assumed.** Every text colour in this file clears WCAG AA (4.5:1) against the surface it is specified on — including 11px chips and tab labels, which is exactly where Chinese mobile apps usually fail.

## Colors

### Two tones per semantic — and why

Each status hue exists in **two tones**, and the distinction is not cosmetic:

| Role of the token | Example | Used for |
| --- | --- | --- |
| `semantic-*` (saturated) | `{colors.semantic-success}` #00B42A | **Non-text marks**: status dots, progress fills, icon strokes, 1px left borders |
| `semantic-*-ink` (darkened) | `{colors.semantic-success-ink}` #087A1E | **Text**: chip labels, banner copy, amount figures |

The saturated tone is what reads as "green" at a glance; the darkened tone is what reads as green **and** is legible. Using #00B42A for an 11px chip label gives 2.63:1 — below half the WCAG AA minimum, and the most common accessibility failure in this category of product. Using #087A1E for a progress bar fill makes the bar look muddy. Two tones, one meaning.

### Brand & Accent

- **工程宝蓝** ({colors.primary} #165DFF): Brand mark, the single primary CTA fill, active tab icon+label, progress fill, key figures. 5.19:1 on white.
- **Primary Pressed** ({colors.primary-pressed} #0E42D2): `active` state of the primary CTA, and the text colour inside `{components.chip-active}` (7.70:1 on white, 6.72:1 on `{colors.primary-soft}`).
- **Primary Soft** ({colors.primary-soft} #E8F0FF): Circular icon tiles, active chips, the login hero wash, disabled button fill.
- **Primary Wash** ({colors.primary-wash} #F2F7FF): Informational banner backgrounds (e.g. "本功能仅用于装修期间临时保管门锁密码").
- **On Primary** ({colors.on-primary} #FFFFFF): Text and icons on any primary or danger fill.

### Surface

- **Canvas** ({colors.canvas} #F5F7FA): Page background everywhere.
- **Surface** ({colors.surface} #FFFFFF): Cards, list rows, tab bar, bottom sheets.
- **Surface Sunken** ({colors.surface-sunken} #F7F8FA): Input fields, signature pad, the read-only strip inside a card, upload tiles.
- **Surface Overlay** ({colors.surface-overlay} #FFFFFF): Modal sheets and action sheets — same white as cards, lifted by `{colors.scrim}` behind them.
- **Scrim** ({colors.scrim} rgba(29,33,41,0.45)): The backdrop behind a bottom sheet. 45% — enough to push the page back without making it look disabled.

### Text

| Token | Value | Contrast on white | Use |
| --- | --- | --- | --- |
| `{colors.ink}` | #1D2129 | 13.9:1 | Headings, primary values, body copy |
| `{colors.ink-secondary}` | #4E5969 | 7.10:1 | Supporting sentences, comment bodies, ghost-button labels |
| `{colors.ink-tertiary}` | #626B79 | 5.39:1 | Timestamps, helper text, inactive tabs, empty states, disabled labels — **and indicator glyphs** (list chevrons, the "+" in an empty upload tile) |

> **There is no fourth grey step.** A common pattern is a near-invisible `#C9CDD4` for chevrons and placeholder glyphs; it was removed here because that tone measures 1.59:1 on white — below even the 3:1 non-text minimum (WCAG 1.4.11), i.e. genuinely hard to see on a phone in daylight. Chevrons and the upload "+" use `{colors.ink-tertiary}`, which is darker than the usual chevron but actually legible. `{colors.hairline-strong}` (#C9CDD4) survives only as a **non-text** colour — the dashed upload outline and the 36×4px sheet drag handle (a solid bar, not a letter).

### Semantic

| Family | Mark tone | Text tone | Soft fill | Meaning |
| --- | --- | --- | --- | --- |
| Success | `{colors.semantic-success}` #00B42A | `{colors.semantic-success-ink}` #087A1E | `{colors.semantic-success-soft}` #E8FFEA | 已通过 / 已结清 / 100% complete |
| Warning | `{colors.semantic-warning}` #FF7D00 | `{colors.semantic-warning-ink}` #A85400 | `{colors.semantic-warning-soft}` #FFF7E8 | 待监理审核 / 待业主确认 / 待整改 / 待付款 |
| Danger | `{colors.semantic-danger}` #F53F3F | `{colors.semantic-danger-ink}` #B22A26 | `{colors.semantic-danger-soft}` #FFECE8 | 已驳回 / 已逾期 / 支出金额 / 删除 |
| Neutral | `{colors.semantic-neutral}` #86909C | `{colors.semantic-neutral-ink}` #5E6673 | `{colors.semantic-neutral-soft}` #F2F3F5 | 未开始 / 已完工 / 已归档 / 已失效 |

**`{colors.semantic-danger-solid}` (#C62828)** is the *fill* for a destructive button that carries white text — #F53F3F with white on top is only 3.71:1 and is not usable as a button. The saturated #F53F3F stays as the mark tone (dots, borders) and as the field-error outline.

**`{colors.chart-track}` (#F2F3F5)** is the 6px progress track — one step darker than `{colors.canvas}` so the track is visible on a white card.

### Role (identity, not semantics)

| Role | Text (on soft) | Soft background |
| --- | --- | --- |
| 工长 | `{colors.role-foreman-ink}` #087A1E | `{colors.role-foreman-soft}` #E8FFEA |
| 监理 | `{colors.role-supervisor-ink}` #0E42D2 | `{colors.role-supervisor-soft}` #E8F0FF |
| 业主 | `{colors.role-owner-ink}` #A85400 | `{colors.role-owner-soft}` #FFF7E8 |

> **Roles deliberately have no saturated mark tone.** A bright `#00B42A` chip label reads at 2.63:1, and a white glyph on a bright role fill at 2.1:1 — the latter is what a solid avatar with a white icon would give. Role identity is therefore always **soft background + ink text** (`{components.role-chip-*}` and `{components.avatar-*}`), which clears AA on every surface. The saturated hues that *do* exist are the semantic ones, and they are used only for status dots and progress fills — never for a role.

> Role and semantic families draw from the **same three hues** — today the hex values coincide, but the tokens are separate and that is the point. A **role** chip sits next to a person's name or on 角色选择; a **semantic** chip sits next to a status. Reference `role-*` for people and `semantic-*` for statuses. Because the hexes match, swapping them produces no visible difference *today* — and a real one the moment either family is retuned, which is exactly when nobody will remember why the "进行中" chip turned green.

## Typography

### Font Family

- **Primary**: `PingFang SC` (iOS), falling back to `Noto Sans SC` / `Source Han Sans SC` (Android) and then `system-ui`.
- All numerals use **tabular figures** (`font-variant-numeric: tabular-nums`) so amounts and percentages do not shift width as they update. This matters on the ledger screen where a ±¥0.01 rebuild would otherwise make a whole column twitch.

### Hierarchy

| Token | Size | Weight | Line height | Use |
| --- | --- | --- | --- | --- |
| `{typography.display-number}` | 40px | 700 | 1.05 | The single biggest number on a screen: 60% on 进度首页, ¥30,000 on 阶段结算单 |
| `{typography.display-xl}` | 34px | 700 | 1.15 | Login wordmark, 项目详情 project name |
| `{typography.display-lg}` | 28px | 700 | 1.20 | Hero numbers in narrow cards, 门锁密码明文, 结算单 total |
| `{typography.title-lg}` | 20px | 600 | 1.30 | Page titles inside a navigation bar, modal titles |
| `{typography.title}` | 17px | 600 | 1.35 | Card titles (「我的项目」「验收管理」), sheet headers |
| `{typography.title-sm}` | 15px | 600 | 1.35 | Row titles (stage name, member name, ledger remark) |
| `{typography.body}` | 15px | 400 | 1.60 | Body copy, form inputs, list-row secondary text |
| `{typography.body-sm}` | 13px | 400 | 1.50 | Helper text, timestamps, comment bodies, banners |
| `{typography.caption}` | 11px | 400 | 1.40 | Tab labels, footnotes |
| `{typography.button}` | 16px | 600 | 1.20 | Primary/secondary CTA labels |
| `{typography.button-sm}` | 14px | 600 | 1.20 | Inline actions, sheet buttons |
| `{typography.chip}` | 11px | 500 | 1.30 | Status and role chips |
| `{typography.eyebrow}` | 12px | 500 | 1.30 | Group headers (「进行中」「已完成」) — tracking 0.5px only, no uppercase (Chinese has no case) |
| `{typography.amount}` | 17px | 600 | 1.30 | Money values in list rows |

### Principles

1. **Weight carries hierarchy, not size alone.** The jump from body 400 to title-sm 600 is enough to separate a row title from its subtitle; do not also bump the size by 4px.
2. **Two sizes minimum for any numeric block**: the value at `display-*`, the label at `body-sm` in `{colors.ink-tertiary}`. Never set a bare number without a label.
3. **No text below 11px.** Mini-programs are read at inconsistent distances and the OS font-size setting is not reliably honoured. 11px is the floor, and it is only used for chips and tab labels — both of which sit at AA contrast.
4. **Truncate at two lines, not one.** Chinese project names and addresses are long; a single-line ellipsis on a project card hides the part that distinguishes two similar projects.
5. **Amounts always show two decimals** — `¥30,000.00`, never `¥3万` or `¥30,000`. The backend stores `DECIMAL(12,2)`; a rounded display invites arguments about a one-cent discrepancy.
6. **Numbers are either `{colors.ink}` or `{colors.primary}`.** A value the user needs to read never gets a muted tone — muted is for labels, not for the data itself.

## Layout

### Spacing System

- Base unit **4px**. All paddings and gaps are multiples of 4.
- **Page gutter**: 16px on both sides. No card ever touches the screen edge.
- **Card gap**: 12px vertically. Cards are separated by the canvas showing through, not by dividers.
- **Card padding**: 16px. Inner rows use 14px vertical padding and no horizontal padding (they inherit the card's 16px).
- **Section spacing**: 32px between major groups (above a group header).
- **List row height**: minimum 48px; rows with two lines of text settle at 64–72px.

### Grid & Container

- Single column. No multi-column card grids anywhere in the mini-program — the screen is 375–430pt wide and a 2-up grid would make every project name wrap.
- Three-up **stat tiles** are the one exception: they hold a single number and a two-to-three-character label (本月汇报 / 待整改 / 待验收).
- Horizontal scroll is allowed only for the **filter chip row** (进行中 / 已完工 / 已归档) and the **photo strip**; it never applies to cards.

### Whitespace Philosophy

Whitespace is used to separate **decisions**, not to decorate. A card that asks the user to do something (提交汇报, 签名确认) sits alone on its whitespace; a card that only reports status is packed tightly with the next one. The result is that "where can I tap" is legible from the spacing alone.

## Elevation & Depth

| Level | Treatment | Use |
| --- | --- | --- |
| 0 | `{colors.canvas}` | Page background |
| 1 | `{colors.surface}` + 1px `{colors.hairline}` border, shadow `0 2px 8px rgba(29,33,41,0.04)` | All cards and list containers |
| 2 | `{colors.surface}` + shadow `0 4px 16px rgba(29,33,41,0.08)` | Floating action, sticky header over scrolling content |
| 3 | `{colors.surface-overlay}` over `{components.modal-backdrop}`, shadow `0 -8px 32px rgba(29,33,41,0.16)` | Bottom sheets, action sheets, 项目切换 |
| — | `0 -1px 0 {colors.hairline}` | The bottom tab bar's top edge — a shadow would imply the bar floats, which it does not |

**Rules:** never use a shadow to separate two elements at the same level (use `{components.card-divider}`). Never stack two shadows. A card already inside a sheet gets no shadow at all — the sheet provides the elevation.

## Shapes

### Border Radius Scale

| Token | Value | Use |
| --- | --- | --- |
| `{rounded.xs}` | 4px | Chips, small tags, inner dividers |
| `{rounded.sm}` | 6px | Inline buttons, inputs with tight height |
| `{rounded.md}` | 8px | Primary/secondary buttons, inputs, small cards, bottom-sheet action rows |
| `{rounded.lg}` | 12px | **The default card radius.** Project cards, stage cards, ledger cards |
| `{rounded.xl}` | 16px | Hero cards, bottom sheets, the login panel |
| `{rounded.xxl}` | 20px | The 角色选择 card stack |
| `{rounded.pill}` | 999px | Progress tracks and fills, **only** |
| `{rounded.full}` | 999px | Avatar badges, circular icon tiles |

**Not pill-round:** cards, buttons, tags, inputs. Pills are reserved for progress bars and circles — the two shapes that are genuinely round in the physical world of this product (a dial and a face).

### Iconography

- **Style**: 2px stroke, rounded caps, 24×24 viewBox. Filled icons only for the active tab state.
- **Color**: `{colors.ink-tertiary}` for neutral, `{colors.primary}` for active, a semantic **mark** tone only when the icon *is* the status (a green check).
- **Pairing**: an icon never appears alone as a tap target. Circular `{components.icon-tile}` 44×44 tiles pair an icon with a label beneath or beside.
- **Domain glyphs** (used consistently): ruler → 进度, clipboard-check → 验收, wallet → 记账, user → 个人中心, house → 项目, signature → 签名, lock → 门锁密码, map-pin → 考察.

### Photography & Illustration

- The only photographic surface is the **login hero**: a bright, uncluttered interior photo behind a `{colors.primary-soft}` → white gradient, at 40% opacity. It establishes "this is about homes" in one glance. No photo appears anywhere else — every other screen is information, and a photo would compete with the numbers.
- Empty states use a single line-art illustration in `{colors.hairline-strong}` at most 120px tall, never a colored cartoon.

## Components

### Identity & Login

- **`{components.card-hero}`** — the login screen's upper panel. Photo at 40% under a white-to-`{colors.primary-wash}` gradient; the wordmark 工程宝 at `{typography.display-xl}` in `{colors.ink}`, the tagline 「让装修工程更透明、更可控」 at `{typography.body-sm}` in `{colors.ink-tertiary}`.
- **Role card** (角色选择) — a full-width `{rounded.xxl}` card, 72px tall, holding a 44px `{components.icon-tile}` whose background is the role-soft colour, the role name at `{typography.title}`, and the role's one-line description at `{typography.body-sm}` in `{colors.ink-tertiary}`. Trailing `{components.chevron}`. The three cards are stacked with 12px gaps — **not** a grid, because the descriptions differ in length.

### Cards

- **`{components.card}`** — the default container. 12px radius, 16px padding, hairline border, no shadow above level 1.
- **`{components.project-card}`** — carries: project name (`{typography.title}`), address + area at `{typography.body-sm}` in `{colors.ink-tertiary}`, a status `{components.chip-*}`, a thin `{components.progress-track}` + `{components.progress-fill}` with the percentage right-aligned in `{colors.primary}`, and the role chip when the user holds more than one role across projects.
- **`{components.stat-tile}`** — three-up. Value at `{typography.display-number}` in `{colors.ink}` (or `{colors.primary}` when it is the screen's headline metric), label at `{typography.caption}` in `{colors.ink-tertiary}` below.
- **Hero number block** (进度首页 / 阶段结算单) — the percentage or total at `{typography.display-number}`, the label 「当前进度」 at `{typography.body-sm}` above it, and the stage name / period at `{typography.body-sm}` below. Left-aligned inside a white card; the blue is used only on the number, never on a filled panel behind it.
- **`{components.card-divider}`** — a 1px `{colors.hairline}` rule inset 16px from the left, separating rows inside a card. It is the only divider in the system.

### Buttons

- **`{components.button-primary}`** — 48px tall, `{rounded.md}`, full width minus 32px gutters, pinned 16px above the safe-area inset. **One per screen.** Label is a verb phrase: 「手机号登录」「提交自检」「提交确认」「登记支出」. Pressed → `{components.button-primary-pressed}`; disabled → `{components.button-primary-disabled}`.
- **`{components.button-secondary}`** — white fill, 1px `{colors.primary}` border, primary label. Used when a screen has a secondary action that is still constructive (「保存草稿」).
- **`{components.button-danger}`** — solid `{colors.semantic-danger-solid}`. Reserved for irreversible actions (「失效密码」「注销账号」). Always preceded by a confirmation sheet using `{components.modal-backdrop}`.
- **`{components.button-ghost}`** — text + optional icon, no border, `{colors.ink-secondary}`, on a white surface. Used inside cards for tertiary actions (「查看全部」「重新提交」).
- **`{components.button-text-link}`** — primary-coloured inline text on white. Used for 「查看详情」 at the end of a row.
- **Disabled state**: `{colors.primary-soft}` fill with `{colors.ink-tertiary}` label, and a one-line reason directly beneath at `{typography.caption}` — disabled buttons in this product always say why (「请先完成自检」).

### Inputs & Forms

- **`{components.text-input}`** — 48px tall, `{colors.surface-sunken}` fill, no border at rest. Focus → `{components.text-input-focused}` (white fill + 1px primary border). Label sits **above** the field at `{typography.body-sm}`, never as a placeholder — a placeholder disappears exactly when the user needs it.
- **Numeric fields** (完成度, 金额) use `type="digit"` and show a persistent unit suffix (%, 元) at `{typography.body}` in `{colors.ink-tertiary}` inside the field's right edge.
- **`{components.upload-tile}`** — an 88×88 `{rounded.md}` tile with a dashed `{colors.hairline-strong}` border and a centred plus in the same colour. Filled tiles carry a 20px delete affordance in the top-right corner over a 40% scrim.
- **Validation**: error text replaces the helper text beneath the field, in `{colors.semantic-danger-ink}` at `{typography.body-sm}`, and the field outline turns `{colors.semantic-danger}`. Never show an error as a toast — the user would have to guess which field.

### Lists & Rows

- **`{components.list-row}`** — 14px vertical padding, `{components.card-divider}` inset from the left (so the rule aligns with the text, not the card edge). Trailing `{components.chevron}` for navigation; trailing value at `{typography.body-sm}` in `{colors.ink-tertiary}` for read-only data; trailing switch for toggles. Pressed → `{components.list-row-pressed}`.
- **`{components.stage-row}`** — the timeline unit. A 24px status dot on the left (blue ring + white core = active, green check = accepted, `{colors.semantic-neutral}` ring = locked, amber ring = pending acceptance), stage name at `{typography.title-sm}`, percentage at `{typography.body-sm}` in `{colors.ink-tertiary}`, and — for locked stages — the reason 「水电阶段未结清」 on a second line in `{colors.ink-tertiary}`.
- **`{components.ledger-row-expense}`** + `{components.ledger-amount-expense}` / `{components.ledger-amount-income}` — the amount is the row's right edge. Expenses in `{colors.semantic-danger-ink}`, income in `{colors.semantic-success-ink}`, always with a `+`/`−` sign so the direction survives being read at a glance. Category and remark go on the left; date on the second line.

### Status & Feedback

- **`{components.chip-active}` / `{components.chip-pending}` / `{components.chip-passed}` / `{components.chip-danger}` / `{components.chip-neutral}`** — 11px, `{rounded.xs}`, 2×6px padding, always using the `-ink` tone for the label. A chip never floats on the canvas; it sits inside a card or next to a row title.
- **`{components.notice-banner}`** — a full-width informational strip inside a card, for 「本功能仅用于装修期间临时保管门锁密码，不是安防方案」 and the 「修改模板不影响已生成的项目」 notice. Primary wash background, `{colors.ink-secondary}` text.
- **`{components.warning-banner}`** — amber soft background with `{colors.semantic-warning-ink}` text. Used for the 门禁提示 card (「下一阶段已锁定：当前阶段未结清」) and for 「密码已失效，请更换实体门锁密码」.
- **Toasts** are never the primary channel for an error. They are used only for success acknowledgements and are capped at one line with no action.

### Navigation

- **`{components.tab-bar}`** — 4 tabs, 56px tall plus the safe-area inset. Icon 24px + label 11px, 4px apart. Active → `{components.tab-item-active}` (filled icon + `{colors.primary}` label); inactive → `{components.tab-item-inactive}`.
- **Tab sets differ by role**: 工长/业主 see 进度 / 验收 / 记账 / 个人中心; **监理 sees 进度 / 验收 / 个人中心 only** — the ledger tab is removed entirely, not disabled, because the supervisor has no business seeing the money at all.
- **Navigation bar** — `{colors.surface}`, 44px content height, title at `{typography.title-lg}` centred, back `{components.chevron}` on the left. The **WeChat capsule button** occupies the top-right; the custom nav bar must reserve 87×32px there and must not place any control underneath it.
- **`{components.bottom-sheet}`** — `{rounded.xl}` top corners only, drag handle 36×4px in `{colors.hairline-strong}` centred 8px from the top, over `{components.modal-backdrop}`.

### Domain Components

- **`{components.signature-pad}`** — 200px tall, `{colors.surface-sunken}`, dashed `{colors.hairline-strong}` inner border, prompt 「请在此处签名」 at `{typography.caption}` in `{colors.ink-tertiary}` centred. Clearing requires a confirmation.
- **Acceptance item row** — a 24px circle (empty stroke = unfilled, green filled check = passed, red filled cross = failed), item name at `{typography.body}`, and an optional remark line.
- **Door-code row** — name at `{typography.title-sm}`, the plaintext code at `{typography.display-lg}` in **`{colors.ink}`** (deliberately *not* blue: it is data, not an action), a 「已失效」 `{components.chip-neutral}` when revoked, and a copy affordance in `{colors.ink-tertiary}`. Above the list, a `{components.notice-banner}` carries the capability-boundary sentence that must always be visible.
- **Message row** — 8px unread dot in `{colors.semantic-danger}` on the left of the title, title at `{typography.title-sm}`, one-line preview at `{typography.body-sm}` in `{colors.ink-tertiary}`, timestamp right-aligned at `{typography.caption}`. Unread rows use a `{colors.primary-wash}` background; read rows are plain `{colors.surface}`.

## Do's and Don'ts

### Do

- Keep exactly one `{components.button-primary}` visible per screen, pinned to the bottom above the safe area.
- Put the number first and make it big on every screen that has one — progress %, amount due, count of pending items.
- Use the role colour on the avatar badge and role chip, the same three hues every time.
- Use the **`-ink`** token for any text and the **saturated** token for dots, fills and borders. This is what keeps 11px chips legible.
- Say *why* whenever something is disabled, locked, or empty — one sentence in `{colors.ink-tertiary}` at `{typography.body-sm}`.
- Use `{colors.canvas}` as the page background and `{colors.surface}` for every card. Let the 16px gutter show the canvas.
- Separate rows with `{components.card-divider}`, not with a shadow.
- Show amounts with two decimals and a sign (`+¥30,000.00` / `−¥18,000.00`).
- Reserve the top-right 87×32px for the WeChat capsule in any custom navigation bar.
- Keep the four-tab bar in the same order across roles, removing tabs that the role cannot use rather than disabling them.

### Don't

- Don't use `{colors.primary}` as a card or section background. Blue fills are for buttons, progress, and chips only.
- Don't use `{colors.semantic-success}` (#00B42A) or `{colors.semantic-warning}` (#FF7D00) as a **text** colour — those are mark tones and fail AA as text.
- Don't convey status by colour alone — every chip carries text.
- Don't reuse a role colour for a status or a semantic colour for a role.
- Don't put two primary buttons on one screen, and don't style a secondary action as primary.
- Don't use pill corners on cards, buttons, or tags. Pills are for progress bars and circular avatars only.
- Don't shrink touch targets below 44×44px, even for icon-only affordances.
- Don't introduce a lighter "chevron grey" below `{colors.ink-tertiary}` — it will not survive daylight on a phone.
- Don't show a toast for a form error; mark the field.
- Don't render a photo, illustration, or decorative gradient anywhere except the login hero and empty states.
- Don't invent a dark theme — this system is light-only (see Known Gaps).
- Don't show a locked stage without its reason line, and don't hide the door-code capability disclaimer.

## Responsive Behavior

### Device Targets

| Name | Logical width | Notes |
| --- | --- | --- |
| iPhone SE (2/3) | 375pt | Narrowest supported; the reference layout is tuned to this |
| iPhone 14 / 15 | 390pt | Default design width |
| iPhone 14 Pro Max | 430pt | Cards stretch; type does **not** scale up |
| Android (common) | 360pt | Same layout; PingFang falls back to Noto Sans SC |

Design at **375pt / 750rpx**. When a frontend language is required, express lengths in `rpx` (1px = 2rpx at 375pt); tokens above are specified in px and convert 1:1.

### Touch Targets

- Primary/secondary CTAs: 48px tall, full width minus gutters.
- Every list row: ≥48px; rows with metadata ≥64px.
- Icon-only affordances: ≥44×44px hit area even when the glyph is 24px.
- Chips and tab labels are read-only targets; the tab item's hit area is the full 56px bar height ÷ 4 columns, not the glyph.

### Safe Areas & WeChat Chrome

- **Bottom**: reserve `env(safe-area-inset-bottom)` (34px on notch devices) beneath the tab bar and beneath any pinned CTA.
- **Top**: status bar 44px on notch devices; the custom navigation bar sits below it.
- **Capsule button**: 87×32px at the top-right, ~7px from the right edge and ~4px below the status bar. Nothing else may occupy that rectangle.
- Content never scrolls under the tab bar: the scroll container gets `padding-bottom: 56px + safe-area + 16px`.

### Collapsing Strategy

- **Type does not scale with width.** A 430pt screen gets more breathing room, not larger text — the same 15px body keeps the information density consistent across devices.
- **Two-line truncation** on project names and addresses; a `…` at the end of the second line.
- **Filter chips** scroll horizontally rather than wrapping; the active chip is scrolled into view on mount.
- **Photo strips** scroll horizontally at 88×88px; the count badge (`3/9`) is pinned to the last tile.
- **Long lists** paginate at 20 rows with an inline 「加载更多」 row — infinite scroll is not used because users often need to jump back to a known position.

## Accessibility

- Every text colour in this file clears **WCAG AA 4.5:1** against its specified background. The `-ink` / mark-tone split exists for exactly this reason.
- Status is never colour-only: every chip has a text label, every progress bar has a number, every lock has a reason sentence.
- Minimum type size is 11px, used only for chips and tab labels (both at AA contrast).
- Focus-visible (for the future admin-console parity and for keyboard/assistive input): 1px `{colors.primary}` outline, 2px offset.
- The door-code screen carries a mandatory `{components.notice-banner}` stating the capability boundary; it is not dismissible.

## Screen Inventory

The design covers 23 screens across five groups. Each row is a screen Stitch should be able to generate from this document.

| # | Screen | Role | Key elements | Backed by API |
| --- | --- | --- | --- | --- |
| 01 | 登录页 | 全部 | Hero photo + wordmark, 「手机号登录」 primary CTA, 「微信登录」 text link, 协议勾选 | ✅ |
| 02 | 角色选择页 | 全部 | Three stacked role cards (工长/监理/业主) with role-soft icon tiles | ✅ |
| 03 | 项目列表 | 全部 | Search field, status filter chips, project cards with progress + status chip | ✅ |
| 04 | 项目详情 | 全部 | Project hero, 4-up action tiles, overall progress, stage timeline | ✅ |
| 05 | 项目切换页 | 多项目用户 | Bottom sheet over `{components.modal-backdrop}`, radio list of projects, current one checked | ✅ |
| 06 | 首页（业主视角） | 业主 | Greeting, project card, overall progress, 4 quick actions, latest activity | ✅ |
| 07 | 首页（工长视角） | 工长 | Same shell + 3-up `{components.stat-tile}` (本月汇报/待整改/待验收) | ✅ |
| 08 | 首页（监理视角） | 监理 | Same shell + 待审核 count; **no 记账 tab** | ✅ |
| 09 | 进度首页 | 工长/业主 | Progress ring + `{typography.display-number}` percentage, stage list with status dots | ✅ |
| 10 | 阶段详情 | 工长/业主 | Stage header with %, date range, item rows with mini progress bars | ✅ |
| 11 | 进度汇报 | 工长 | Current 完成度, item picker, stepper, text area, `{components.upload-tile}` strip, 提交 | ✅ |
| 12 | 汇报详情 | 全部 | Reporter header, before/after progress, watermarked photos, comments | ✅ |
| 13 | 验收列表 | 全部 | Segmented control (待我处理/我发起的/已完成), acceptance cards | ✅ |
| 14 | 验收详情 | 全部 | Status banner, item checklist, photos, signature block, action bar | ✅ |
| 16 | 电子签名 | 业主/监理 | `{components.signature-pad}`, clear action, 「确认并提交」 primary CTA | ✅ |
| 19 | 考察路线规划 | 工长/业主 | Map, numbered stop list with times, 「开始导航」 CTA | ⏳ V1.2 |
| 20 | 现场签到 | 工长 | Map + photo evidence, distance chip, 「拍照签到」 CTA | ⏳ V1.2 |
| 21 | 个人中心 | 全部 | Avatar + role chip, project switcher, message entry with red dot, settings rows | ✅ |
| 22 | 消息中心 | 全部 | Category tabs, message rows with unread dot, 全部已读 action | ✅ |
| 23 | 考察记录 | 工长 | Date-grouped visit rows with photos | ⏳ V1.2 |
| 24 | 路线规划详情 | 工长/业主 | Summary card (stops / distance / duration), route map | ⏳ V1.2 |
| 25 | 阶段结算单 | 业主 | Amount hero, 结算总额 / 应扣金额 / 应付, 提交确认 CTA | ✅ |
| 26 | 阶段门禁提示 | 该阶段参与者 | `{components.warning-banner}` explaining the lock, checklist of what unblocks it, 「我知道了」 | ✅ |

> ⏳ marks screens whose backend module is scheduled for V1.2 (考察导航、路线规划、现场留痕, §4.6).
> They belong in the design so the visual language stays coherent, but they cannot be built end-to-end yet.

## Agent Prompt Guide

Use these when asking Stitch to generate or iterate a screen.

**Palette in one line**
> Background `#F5F7FA`; cards `#FFFFFF` with a 1px `#E5E6EB` border and 12px radius; primary `#165DFF`; text `#1D2129` / secondary `#4E5969` / tertiary `#626B79`; success text `#087A1E`, warning text `#A85400`, danger text `#B22A26`.

**Typical screen prompt**
> Design the 进度首页 for 工程宝, a WeChat mini-program for interior renovation. Light canvas `#F5F7FA`, white 12px cards with hairline borders and 16px gutters. Top: project name plus address in 13px `#626B79`, a blue status chip 「进行中」 on `#E8F0FF` with `#0E42D2` text. Below: a white card with a 40px bold `#165DFF` 「60%」, label 「当前进度」 in 11px `#626B79`, and the stage name below. Then a vertical stage timeline: blue ring dot for the active stage, green check for accepted, gray ring for locked stages with a 13px `#626B79` reason line 「上一阶段未结清」. Bottom tab bar with 进度 / 验收 / 记账 / 个人中心, active tab in `#165DFF`. PingFang SC, 15px body, tabular numerals. No illustrations, no gradients, no dark mode.

**Constraints to restate every time**
- One primary CTA per screen, 48px tall, pinned above the safe area.
- Text uses the `-ink` tones; dots and fills use the saturated tones.
- Pills only on progress bars and avatars; cards and buttons are 8–12px radius.
- Every disabled or locked element carries a one-sentence reason.
- Amounts: two decimals, `+`/`−`, tabular figures.
- Reserve 87×32px at the top-right for the WeChat capsule.

**Common iteration asks**
- "Too busy" → remove one card, not one pixel. The rhythm is 12px card gaps; shrinking type below 15px is not the fix.
- "Can't tell the role" → check the avatar badge and role chip; the layout should not change, only the role colour.
- "The status is unclear" → the chip is missing its text label, or a role colour was used for a status.
- "The chip looks muddy" → someone used the mark tone (`#00B42A`) as text. Switch to the `-ink` tone.

## Iteration Guide

1. Edit tokens in the YAML frontmatter first; only then touch prose. A screen generated from changed tokens should look different without any prose edit.
2. Reference components by their `components:` token name (e.g. `{components.project-card}`) so changes propagate.
3. Add a new screen by adding a row to **Screen Inventory** and stating which existing components it composes. New components are added only when no existing one can be configured into it.
4. Keep every colour in the token list. If a screen needs a colour that is not there, that is a signal the token set is wrong — fix it here, not inline.
5. When adding a colour, run it through a contrast check against every surface it will sit on before accepting it. `npx @google/design.md lint DESIGN.md` reports failures — treat those as errors, not noise.
6. When a screen is backed by a real API, the numbers must match the backend exactly: percentages are integers 0–100, amounts carry two decimals, dates are `YYYY-MM-DD`.
7. Review every new screen against **Do's and Don'ts** before accepting it.
8. If a screen needs more than one primary CTA, the screen is doing too much — split it.

## Known Gaps

- **No dark mode.** WeChat supports `wx.onThemeChange`, but this product is used on site in daylight and a dark variant would double the token surface for no user benefit. If it is ever added, invert only `canvas` / `surface` / `ink` — keep the primary and semantic hues, and re-verify `-ink` contrasts against the dark surfaces (they will move in the opposite direction).
- **V1.2 screens are unbuilt.** 19 / 20 / 23 / 24 (考察、路线、签到) have designs here but no backend module; their map area is a placeholder rectangle in this spec.
- **Reference board numbering skips 15, 17, 18.** The supplied concept board goes 14 → 16 → 19. Those screens are assumed to be sub-states of 验收详情 (report preview, photo viewer). They are not specified separately.
- **B-end admin is out of scope.** This document covers the mini-program only; the Vue 3 + Element Plus admin console is a separate design system.
- **Font is not bundled.** `PingFang SC` is an OS font; Android falls back to `Noto Sans SC`. No custom font is loaded, which keeps the mini-program package small (the 2MB main-package budget is a real constraint).
- **Motion is unspecified.** Stitch generates static screens. Where motion exists in the build, keep it to ≤200ms ease-out; no parallax, no spring physics.
- **The 项目详情 action tiles and 首页 quick actions** use the same four icons across roles, but the enabled set differs by role (监理 has no 记账 entry). That per-role matrix lives in the product spec, not here.
- **Contrast was verified for the specified pairs only.** A colour reused on a surface it was not designed for (e.g. `{colors.ink-tertiary}` on a photo overlay) must be re-checked.
