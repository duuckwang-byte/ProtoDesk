# DESIGN.md

## 1. Design Direction

### Visual Style

Clean, restrained, professional mobile B2B interface.

The visual direction combines:

- Financial product professionalism
- Modern SaaS simplicity
- Light gray page background
- White content surfaces
- Blue primary actions
- Clear information hierarchy
- Compact but comfortable mobile spacing

The interface should feel:

- Professional
- Reliable
- Clean
- Efficient
- Calm
- Information-oriented

The interface should NOT feel:

- Marketing-heavy
- Playful
- Decorative
- Futuristic
- Gaming-oriented
- Luxury-oriented
- Over-designed

Prioritize information clarity and task completion over visual decoration.

---

## 2. Core Visual Principles

### 2.1 Surface Hierarchy

Use background color, white surfaces, and borders to establish hierarchy.

Preferred hierarchy:

Page Background
→ White Card
→ Content
→ Primary Action

Do not rely heavily on shadows to separate normal elements.

### 2.2 Blue Is the Primary Action Color

Blue is reserved for:

- Primary buttons
- Primary links
- Selected states
- Active navigation
- Important interactive elements
- Focus indicators
- Progress indicators when appropriate

Do not use multiple competing accent colors.

### 2.3 Neutral First

Most of the interface should consist of:

- White
- Very light gray
- Dark gray
- Medium gray
- Blue

Color should communicate meaning rather than decoration.

### 2.4 Mobile First

Design for touch interaction first.

Controls should be easy to tap with one hand.

Do not simply squeeze a desktop layout into a mobile screen.

### 2.5 Information Density

This is a B2B product.

Do not create excessive whitespace.

Information should be compact, structured, and easy to scan.

However, do not compress controls below comfortable touch sizes.

---

# 3. Color System

## 3.1 Primary Colors

| Token | Value | Usage |
|---|---|---|
| primary | #2563EB | Primary action |
| primary-hover | #1D4ED8 | Pressed / hover |
| primary-light | #EFF6FF | Selected / highlighted background |
| primary-border | #BFDBFE | Blue border |
| primary-text | #1D4ED8 | Blue text |

Blue is the dominant accent color.

Do not introduce purple, cyan, gradient blue, or multiple brand colors unless specifically requested.

---

## 3.2 Background Colors

| Token | Value | Usage |
|---|---|---|
| background | #F5F7FA | Main page background |
| surface | #FFFFFF | Cards and content surfaces |
| surface-secondary | #F9FAFB | Secondary containers |
| surface-selected | #EFF6FF | Selected item |
| surface-disabled | #F3F4F6 | Disabled controls |

Default mobile page background:

#F5F7FA

Default card and content surface:

#FFFFFF

---

## 3.3 Text Colors

| Token | Value | Usage |
|---|---|---|
| text-primary | #1F2937 | Main text |
| text-secondary | #4B5563 | Secondary information |
| text-tertiary | #6B7280 | Supporting information |
| text-disabled | #9CA3AF | Disabled text |
| text-placeholder | #9CA3AF | Input placeholder |
| text-on-primary | #FFFFFF | Text on blue buttons |

Avoid pure black #000000 for normal text.

---

## 3.4 Border Colors

| Token | Value | Usage |
|---|---|---|
| border | #E5E7EB | Standard border |
| border-light | #F0F1F3 | Subtle divider |
| border-strong | #D1D5DB | Stronger form border |
| border-focus | #2563EB | Focus state |

Use borders and dividers instead of heavy shadows.

---

## 3.5 Semantic Colors

| Token | Value | Usage |
|---|---|---|
| success | #16A34A | Success |
| success-light | #F0FDF4 | Success background |
| warning | #D97706 | Warning |
| warning-light | #FFFBEB | Warning background |
| error | #DC2626 | Error |
| error-light | #FEF2F2 | Error background |
| info | #2563EB | Informational |

Semantic colors should only communicate status.

Do not use semantic colors as decorative accents.

---

# 4. Typography

## 4.1 Font

Preferred font:

Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif

Use a clean sans-serif font.

Do not use:

- Serif fonts
- Decorative display fonts
- Handwritten fonts
- Futuristic fonts

---

## 4.2 Type Scale

| Token | Size | Weight | Usage |
|---|---:|---:|---|
| display | 24px | 600 | Major page title |
| title-lg | 20px | 600 | Section title |
| title-md | 18px | 600 | Card title |
| body-lg | 16px | 400 | Important body text |
| body | 14px | 400 | Default text |
| body-medium | 14px | 500 | Important labels |
| caption | 12px | 400 | Supporting information |
| caption-medium | 12px | 500 | Status / metadata |

Avoid extremely large typography on mobile.

The largest normal page heading should generally remain between 20px and 24px.

---

## 4.3 Line Height

Use comfortable line height.

| Font Size | Line Height |
|---:|---:|
| 12px | 18px |
| 14px | 20px |
| 16px | 24px |
| 18px | 26px |
| 20px | 28px |
| 24px | 32px |

Do not use extremely tight line-height.

---

# 5. Spacing System

Use an 8px spacing system with 4px increments when necessary.

| Token | Value |
|---|---:|
| xs | 4px |
| sm | 8px |
| md | 12px |
| lg | 16px |
| xl | 20px |
| 2xl | 24px |
| 3xl | 32px |
| 4xl | 40px |

### Default Spacing

| Element | Spacing |
|---|---:|
| Page horizontal padding | 16px |
| Card internal padding | 16px |
| Section spacing | 20–24px |
| Form field spacing | 12–16px |
| Button gap | 8–12px |
| Icon-to-text gap | 8px |

Do not use excessive 32px+ gaps inside normal mobile content.

---

# 6. Border Radius

Use restrained rounded corners.

| Token | Value | Usage |
|---|---:|---|
| radius-sm | 4px | Small controls |
| radius-md | 8px | Buttons / inputs |
| radius-lg | 12px | Cards |
| radius-xl | 16px | Large containers |
| radius-full | 9999px | Avatar / status indicator only |

Default:

- Card: 12px
- Button: 8px
- Input: 8px
- Modal: 12px
- Small tag: 4px

Avoid excessive pill-shaped UI.

Pill shapes should primarily be used for:

- Status tags
- Small badges
- Avatars
- Compact filters when appropriate

Do not make every button pill-shaped.

---

# 7. Shadows

The default interface should use minimal shadows.

Preferred:

No shadow on normal cards.

Cards should primarily be separated using:

- White surface
- Light gray border

Use shadows mainly for elevated components:

- Modal
- Bottom sheet
- Floating action panel
- Dropdown
- Popover

Do not use large soft shadows around normal cards.

---

# 8. Mobile Layout

## 8.1 Target Viewports

Design primarily for:

- 375px
- 390px
- 393px
- 414px

The layout must gracefully scale to other mobile widths.

---

## 8.2 Page Structure

Preferred structure:

Page
→ Header
→ Content
→ Cards / Sections
→ Optional Bottom Navigation

Default page:

- Background: #F5F7FA
- Horizontal padding: 16px

---

## 8.3 Single Column

Mobile layouts should normally use a single primary content column.

Do not force multiple narrow columns onto mobile.

When desktop content contains multiple columns:

Desktop:
Column A | Column B | Column C

Mobile:
Column A
Column B
Column C

---

# 9. Header

Mobile header should be simple and compact.

Recommended height:

56px

Typical structure:

[Back]    Page Title    [Action]

or:

[Logo]                 [Action]

Rules:

- White background
- Bottom border optional
- No large header image
- No gradient
- No oversized title
- Maximum 1–2 actions
- Keep important actions visible

Do not create a desktop navigation bar on mobile.

---

# 10. Bottom Navigation

Use bottom navigation only when the application has 3–5 primary sections.

Typical structure:

Home
Projects
Funds
Messages
Profile

Rules:

- White background
- Top border
- Height approximately 56–64px
- Maximum 5 items
- Simple icons
- Active item uses primary blue
- Inactive item uses gray

Avoid:

- Large icons
- Large labels
- Gradient backgrounds
- Floating oversized navigation
- Excessive decoration

---

# 11. Cards

Cards are a primary structural component.

## 11.1 Standard Card

Default:

- Background: #FFFFFF
- Border: 1px solid #E5E7EB
- Border radius: 12px
- Padding: 16px

Cards should contain logically related information.

Use cards for:

- Project summary
- Funding information
- Company information
- Progress
- Tasks
- Key metrics
- Forms
- Activity records

---

## 11.2 Card Rules

Do not put every individual field into a separate card.

Avoid excessive nesting.

Bad:

Card
→ Card
→ Card
→ Card

Preferred:

One card
→ Related information
→ Sections
→ Dividers

Components should remain visually simple.

---

# 12. Buttons

## 12.1 Primary Button

Default:

- Background: #2563EB
- Text: #FFFFFF
- Height: 44–48px
- Border radius: 8px
- Font size: 14px
- Font weight: 500

Pressed:

- Background: #1D4ED8

Use primary buttons for the most important action on the screen.

Examples:

- 保存
- 提交
- 确认
- 继续
- 联系资金方
- 创建项目

Do not use multiple visually equal primary buttons in the same area unless they represent genuinely equal actions.

---

## 12.2 Secondary Button

Default:

- Background: #FFFFFF
- Text: #374151
- Border: 1px solid #D1D5DB
- Height: 44–48px
- Border radius: 8px

Use for secondary actions.

---

## 12.3 Text Button

Use for low-emphasis actions.

Default:

- Background: transparent
- Text: #2563EB

Do not turn every action into a blue button.

---

## 12.4 Destructive Button

Use red only for destructive actions.

Default:

- Background: #DC2626
- Text: #FFFFFF

Examples:

- 删除
- 撤销
- 终止

Destructive actions should not visually compete with the primary business action.

---

# 13. Touch Targets

All important interactive elements should provide at least:

44px × 44px

Preferred:

- Button height: 44–48px
- Input height: 44–48px
- Navigation item height: ≥44px
- Icon button: 44px × 44px

Do not create tiny clickable icons.

Icons may visually appear smaller than 44px, but their clickable area should remain at least 44px × 44px.

---

# 14. Forms

Forms should be simple and structured.

## 14.1 Input

Default:

- Height: 44–48px
- Background: #FFFFFF
- Border: 1px solid #D1D5DB
- Border radius: 8px
- Horizontal padding: 12px
- Font size: 14px

---

## 14.2 Focus

Focus state:

- Border: #2563EB
- Optional subtle blue focus ring

---

## 14.3 Label

Default:

- Font size: 14px
- Font weight: 500
- Color: #374151
- Margin bottom: 8px

---

## 14.4 Placeholder

Default:

- Color: #9CA3AF

Do not use placeholder text as the only field label for important forms.

---

# 15. Select / Dropdown

Use standard mobile-friendly select patterns.

Example:

项目状态                    ▼

Rules:

- White background
- Gray border
- 44–48px height
- 8px radius
- Clear selected value
- Chevron on the right

Do not use decorative dropdown controls.

For long option lists on mobile, prefer a bottom sheet or full-screen selection page.

---

# 16. Tabs

Tabs should be used for switching between related content.

Example:

基本信息    项目进展    资金方

Active:

- Color: #2563EB
- Bottom border: 2px solid #2563EB

Inactive:

- Color: #6B7280

Avoid giant pill tabs unless specifically requested.

When tabs exceed available width, allow horizontal scrolling.

Do not wrap tabs into multiple lines.

---

# 17. Lists

Mobile lists should prioritize scanability.

Preferred list item structure:

Primary Information
Secondary Information
Status
Optional navigation indicator

Example:

XX科技有限公司
融资金额 5000万
[尽调中]                                  >

Avoid showing too many fields in one list item.

Use dividers between list items when necessary.

---

# 18. Status

Statuses should be visually clear but restrained.

Preferred:

[沟通中]
[尽调中]
[已完成]
[待处理]

Use light backgrounds.

## Status Colors

Blue:

- Background: #EFF6FF
- Text: #1D4ED8

Green:

- Background: #F0FDF4
- Text: #15803D

Orange:

- Background: #FFFBEB
- Text: #B45309

Red:

- Background: #FEF2F2
- Text: #B91C1C

Do not use saturated full-color blocks for ordinary status labels.

---

# 19. Progress

Progress should be simple and information-oriented.

Preferred:

项目推进

●────●────○────○

初筛   沟通   尽调   打款

Active:

#2563EB

Inactive:

#D1D5DB

Avoid decorative progress graphics.

---

# 20. Modal

Mobile modals should normally use bottom sheets.

Preferred structure:

Title

Content

Primary Action
Secondary Action

Rules:

- White background
- 12–16px top radius
- Clear title
- Adequate bottom safe-area spacing
- Large touch targets
- Subtle backdrop

Avoid desktop-style centered dialog boxes on small mobile screens unless the content is extremely short.

---

# 21. Bottom Sheet

Use bottom sheets for:

- Filters
- Selection
- Actions
- Status changes
- Form editing
- More options

Typical structure:

Handle

Title

Content

Primary Action
Secondary Action

Rules:

- White background
- 12–16px top radius
- Respect safe area
- Keep actions reachable
- Allow scrolling for long content
- Do not make every interaction a bottom sheet

Bottom sheets should not occupy the entire screen unless necessary.

---

# 22. Toast / Feedback

Use small temporary feedback.

Example:

✓ 保存成功

Rules:

- Compact
- Short message
- Easy to notice
- Do not block the main content
- Automatically disappear when appropriate

Do not use large notification banners for simple success messages.

---

# 23. Empty State

Keep empty states simple.

Preferred:

暂无项目

当前还没有项目数据

[创建项目]

Avoid:

- Large illustrations
- Decorative graphics
- Excessive text
- Marketing slogans

---

# 24. Loading

Prefer simple loading indicators or skeletons.

Text:

加载中...

Skeleton should use neutral gray blocks.

Do not use:

- Complex animated loading graphics
- Decorative loading animations
- Large spinning elements

---

# 25. Icons

Use simple line icons.

Recommended:

- 16–20px visual size
- Simple stroke
- Neutral gray by default
- Blue for active state
- Consistent stroke width

Do not use emoji as UI icons.

Do not mix multiple icon styles.

Icons should support information hierarchy rather than become decorative elements.

---

# 26. Images

Images should only be used when they provide information.

Acceptable:

- Company logos
- User avatars
- Product images
- Relevant documents
- Business-related images

Avoid:

- Large marketing hero images
- Decorative backgrounds
- Random stock photography
- Full-screen photography
- Decorative illustrations

---

# 27. Data Visualization

Charts should be simple and readable on mobile.

Rules:

- Avoid more than 3–5 visual series
- Prioritize key numbers
- Use blue as the primary series
- Use semantic colors only when meaningful
- Avoid 3D charts
- Avoid decorative chart backgrounds
- Avoid excessive labels

Charts should communicate information rather than decoration.

---

# 28. Financial / B2B Data

Important financial information should have strong hierarchy.

Example:

融资金额

¥5,000万

融资方式
供应链金融

项目状态
[沟通中]

The key number should be visually stronger.

Do not make every number huge.

Recommended hierarchy:

Key Number
→ Label
→ Supporting Information

For financial values:

- Keep units explicit
- Use consistent number formatting
- Avoid unnecessary decimal places
- Keep currency symbols and units clear

---

# 29. Information Hierarchy

Every screen should have one obvious primary focus.

Priority:

1. Page Title
2. Primary Information
3. Primary Action
4. Secondary Information
5. Supporting Metadata

Do not make every element visually prominent.

Use:

- Font weight
- Font size
- Color
- Spacing
- Borders

to establish hierarchy.

Do not rely on color alone.

---

# 30. Page Density

Target density:

Compact but breathable.

Default:

- 16px page padding
- 16px card padding
- 12–16px field spacing
- 20–24px section spacing

Avoid:

- 32–48px padding everywhere
- Huge empty areas
- Excessive vertical gaps

This is a B2B mobile application, not a marketing landing page.

---

# 31. Navigation Rules

Primary navigation should be limited.

Maximum:

5 bottom navigation items

Within a page:

Back
Title
Optional Action

Avoid multiple navigation layers unless the product genuinely requires them.

Avoid:

Header navigation
+
Secondary navigation
+
Tabs
+
Floating navigation

unless each layer serves a clear purpose.

---

# 32. Responsive Rules

## Mobile

< 768px

Use:

- Single-column layout
- Full-width cards
- Bottom navigation
- Bottom sheets
- Large touch targets
- Horizontal scrolling tabs where necessary

## Tablet

768px–1024px

Allow:

- Two-column layouts
- Wider cards
- More horizontal information

## Desktop

> 1024px

Desktop layout may use:

- Sidebar
- Multi-column grid
- Data tables
- Larger content areas

However, mobile is the primary design target.

---

# 33. Desktop-to-Mobile Transformation

Never simply shrink the desktop layout.

Desktop:

Sidebar
+
Main Content
+
Multiple Columns

Mobile:

Header
+
Single Column
+
Cards
+
Bottom Navigation

Desktop tables should transform into either:

1. Mobile cards

or

2. Horizontally scrollable tables

Choose based on information complexity.

Do not squeeze a wide desktop table into unreadable mobile columns.

---

# 34. Motion

Use minimal motion.

Preferred transition duration:

150–200ms

Use motion for:

- Bottom sheet
- Modal
- Dropdown
- Navigation transition
- State feedback

Do not use:

- Parallax
- Large entrance animations
- Continuous floating animations
- Decorative motion
- Excessive spring effects

The interface should feel fast and stable.

---

# 35. Elevation Rules

Use three elevation levels.

Level 0:

Page background

Level 1:

Card
→ border only

Level 2:

Dropdown / Popover
→ subtle shadow

Level 3:

Modal / Bottom Sheet
→ medium shadow

Do not use shadows on every component.

---

# 36. Component Reuse

Components should be reusable.

Core components:

- Button
- Input
- Select
- Card
- List
- ListItem
- Status
- Tabs
- Modal
- BottomSheet
- Toast
- EmptyState
- Loading
- Progress
- Navigation

Do not create a visually different button for every page.

Do not create a visually different card for every business scenario.

Use variants on shared components instead.

---

# 37. Component Consistency

Components with the same function must look the same across the application.

For example:

All Primary Buttons:

- Same color
- Same height
- Same radius
- Same typography

All Cards:

- Same basic structure
- Same radius
- Same border treatment
- Same padding

All Inputs:

- Same height
- Same border
- Same radius
- Same focus behavior

Business-specific content may change, but the visual component language should remain consistent.

---

# 38. Interaction Rules

Interactive elements must provide obvious feedback.

Button:

Default
→ Pressed
→ Disabled

Input:

Default
→ Focus
→ Error
→ Disabled

Select:

Default
→ Open
→ Selected

List Item:

Default
→ Pressed
→ Selected if applicable

Do not create interactions without visible state changes.

---

# 39. Disabled State

Disabled components should use:

- Background: #F3F4F6
- Text: #9CA3AF
- Border: #E5E7EB

Disabled elements should not look clickable.

Do not use opacity alone to communicate disabled state.

---

# 40. Error State

Error states should be clear but restrained.

Input:

- Border: #DC2626

Error message:

- Color: #DC2626
- Font size: 12px

Example:

手机号
[请输入正确的手机号]
请输入有效的手机号

Do not use large red warning blocks for ordinary form validation.

---

# 41. Accessibility

Maintain sufficient contrast between:

- Text and background
- Button text and button background
- Status text and status background

Do not rely only on color to communicate important states.

Important states should combine:

- Color
- Text
- Icon
- Position

when appropriate.

Touch targets should be at least 44px.

---

# 42. Safe Area

Mobile layouts must respect device safe areas.

Especially for:

- Bottom navigation
- Bottom sheets
- Fixed action bars
- Full-screen modals

Use safe-area padding where necessary.

Do not place important controls directly against the bottom edge of the viewport.

---

# 43. Fixed Bottom Actions

For pages requiring a persistent primary action:

Preferred structure:

Page Content

...

Fixed Bottom Action Area
[      Primary Action      ]

Rules:

- White background
- Top border
- Safe-area support
- 16px horizontal padding
- Button height 44–48px

Do not allow the fixed action area to cover important content.

---

# 44. Search

Search should remain visually simple.

Preferred:

[ 搜索项目 / 企业名称              ]

Rules:

- White background
- Light border
- 44–48px height
- Search icon optional
- Clear button when text exists

Avoid oversized search areas.

---

# 45. Filter

Filters should use compact controls.

Example:

[全部] [项目状态] [融资方式] [地区]

Rules:

- Horizontal scrolling when necessary
- Selected filter uses light blue background
- Selected text uses primary blue
- Avoid excessive pill styling

For complex filters, open a bottom sheet.

---

# 46. Business Dashboard

Mobile dashboards should prioritize key metrics.

Preferred structure:

Page Title

Key Metrics

Important Status

Recent Activity

Primary Action

Do not attempt to reproduce a desktop dashboard with many charts.

Show the most important 3–5 metrics first.

---

# 47. Project List

For project management applications, preferred mobile project list:

Project Name

Company Name

Financing Amount

Project Status

Latest Progress / Update Time

Optional:

Responsible Person

Example structure:

项目名称
XX科技有限公司

融资金额
5000万

项目状态
[沟通中]

最近进展
已完成资金方初步沟通

Do not display every database field in the list.

---

# 48. Project Detail

Recommended hierarchy:

Header
→ Project Name

Summary
→ Financing Amount
→ Financing Method
→ Project Status

Core Information
→ Company
→ Industry
→ Region
→ Funding Requirement

Progress
→ Current Stage
→ Timeline
→ Latest Updates

Funding Parties
→ Contact Status
→ Latest Progress

Documents
→ Relevant Files

Primary Action
→ Contextual business action

The most important business information should appear near the top.

---

# 49. Fund / Funding Party List

Preferred information hierarchy:

Funding Party Name

Funding Type

Applicable Industry

Funding Amount / Range

Region

Current Matching / Contact Status

Do not expose every internal field in the list view.

---

# 50. AI-Generated UI Rules

When generating UI from this DESIGN.md:

1. Follow the color tokens exactly.
2. Use blue only as the primary accent.
3. Use light gray as the page background.
4. Use white as the primary surface.
5. Prefer borders over shadows.
6. Keep cards simple.
7. Use 8–12px corner radius.
8. Maintain 44–48px touch targets.
9. Use 16px horizontal page padding.
10. Keep information density appropriate for B2B.
11. Avoid decorative elements.
12. Avoid gradients.
13. Avoid glassmorphism.
14. Avoid neumorphism.
15. Avoid excessive rounded pills.
16. Avoid excessive shadows.
17. Avoid giant typography.
18. Avoid unnecessary illustrations.
19. Avoid emoji as UI icons.
20. Do not invent additional brand colors.
21. Do not introduce visual styles that conflict with this document.
22. Do not randomly redesign shared components on different pages.
23. Prefer reusable components.
24. Prefer simple layouts over visually complex layouts.
25. Do not add elements that are not required by the product requirements.

---

# 51. AI Layout Rules

When requirements do not specify a layout:

1. Prefer a single-column mobile layout.
2. Use 16px page padding.
3. Group related information into white cards.
4. Use 20–24px between major sections.
5. Use 12–16px between related fields.
6. Put the primary action in an obvious location.
7. Use bottom sheets for complex mobile selections.
8. Use horizontal scrolling for long tabs or filters.
9. Avoid excessive nested containers.
10. Avoid unnecessary decorative sections.

When there are multiple possible layouts, choose the simplest layout that communicates the required information clearly.

---

# 52. AI Component Rules

Before creating a new component:

1. Check whether an existing component can be reused.
2. If the existing component can support the requirement through a variant, use a variant.
3. Only create a new component when the interaction or information structure is genuinely different.

Do not create:

- Button A
- Button B
- Button C

when they are visually and functionally the same component.

Prefer:

Button
→ Primary
→ Secondary
→ Destructive
→ Text

---

# 53. AI Content Rules

Use realistic business information when generating prototypes.

For B2B / financial products:

Prefer:

- Company names
- Financing amounts
- Financing methods
- Project stages
- Funding party names
- Progress records
- Dates
- Statuses

Avoid:

- Lorem ipsum
- Random marketing slogans
- Excessive placeholder text
- Fake decorative copy

Content should help demonstrate the actual product structure.

---

# 54. AI Prototype Rules

When generating HTML prototypes:

- Use semantic HTML where possible.
- Keep DOM structure reasonably flat.
- Avoid unnecessary wrapper elements.
- Use reusable CSS classes.
- Avoid inline styles unless necessary.
- Keep shared components consistent.
- Keep interactive states explicit.
- Make the prototype responsive.
- Ensure all important interactions have visible feedback.
- Avoid adding functionality not requested by the product requirement.

The generated HTML should remain easy for another AI agent or developer to understand and modify.

---

# 55. Visual Quality Checklist

Before considering a screen complete, verify:

## Layout

- [ ] 16px horizontal page padding
- [ ] Single-column mobile layout where appropriate
- [ ] No unnecessary nested cards
- [ ] Clear information hierarchy
- [ ] Consistent section spacing

## Color

- [ ] Page background is light gray
- [ ] Cards are white
- [ ] Primary actions are blue
- [ ] Text uses neutral gray
- [ ] Borders use light gray
- [ ] No unnecessary accent colors

## Components

- [ ] Buttons are consistent
- [ ] Inputs are consistent
- [ ] Cards are consistent
- [ ] Status styles are consistent
- [ ] Tabs are consistent
- [ ] Navigation is consistent

## Mobile

- [ ] Touch targets are at least 44px
- [ ] Content is readable at 375px width
- [ ] No horizontal overflow unless intentional
- [ ] Fixed bottom elements respect safe areas
- [ ] Bottom sheets are usable
- [ ] Important actions are easy to reach

## Visual Style

- [ ] No gradients
- [ ] No glassmorphism
- [ ] No neumorphism
- [ ] No excessive shadows
- [ ] No excessive rounded pills
- [ ] No decorative hero sections
- [ ] No unnecessary illustrations
- [ ] No emoji icons
- [ ] No excessive animation

---

# 56. Do

Use:

- Light gray background
- White cards
- Blue primary buttons
- Gray borders
- Dark gray text
- Simple line icons
- 8px spacing system
- 8–12px radius
- Compact information layout
- Clear hierarchy
- Consistent components
- Mobile-first layouts
- Bottom sheets
- Bottom navigation when appropriate
- Subtle dividers
- Minimal shadows
- Realistic B2B business data

---

# 57. Don't

Do NOT use:

- Gradients
- Glassmorphism
- Neumorphism
- Large decorative illustrations
- Random colorful cards
- Neon colors
- Purple as a second primary color
- Excessive shadows
- Huge rounded cards
- Every button as a pill
- Emoji icons
- Large hero sections
- Marketing-style layouts
- Excessive whitespace
- Excessive animation
- Random component variations
- Desktop layouts squeezed into mobile
- Excessive nested cards
- Excessive floating elements
- Decorative background patterns
- Unnecessary visual effects

---

# 58. Quick Reference

STYLE

Clean / Professional / B2B / Mobile-first

BACKGROUND

#F5F7FA

CARD

#FFFFFF

PRIMARY

#2563EB

PRIMARY PRESSED

#1D4ED8

PRIMARY LIGHT

#EFF6FF

TEXT

#1F2937

SECONDARY TEXT

#4B5563

TERTIARY TEXT

#6B7280

BORDER

#E5E7EB

SUCCESS

#16A34A

WARNING

#D97706

ERROR

#DC2626

PAGE PADDING

16px

CARD PADDING

16px

CARD RADIUS

12px

BUTTON RADIUS

8px

INPUT RADIUS

8px

BUTTON HEIGHT

44–48px

INPUT HEIGHT

44–48px

MIN TOUCH TARGET

44px

HEADER

56px

BOTTOM NAV

56–64px

BASE SPACING

8px

FONT

Inter / system sans-serif

SHADOW

Minimal

GRADIENT

None

GLASSMORPHISM

None

NEUMORPHISM

None

PRIMARY ACCENT

Blue only

---

# 59. Final Design Principle

When making design decisions, prioritize:

Information clarity
>
Task completion
>
Consistency
>
Touch usability
>
Visual decoration

The final UI should look like a clean, trustworthy, modern B2B mobile application.

It should feel closer to:

Financial SaaS
+
Enterprise Product
+
Modern Mobile App

and NOT like:

Marketing Website
+
AI Landing Page
+
Consumer Social App
+
Gaming UI